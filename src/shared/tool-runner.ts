import { config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { loadCities } from './city-config.js';
import type { CityConfig, ToolRunOptions, ToolRunReport } from './types.js';

// --- Tool Runs API Client ---

async function createToolRun(toolSlug: string): Promise<string | null> {
  try {
    const res = await fetch(config.toolRuns.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.toolRuns.apiKey,
      },
      body: JSON.stringify({ tool_slug: toolSlug, status: 'running' }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Failed to create tool run (${res.status}): ${body}`);
      return null;
    }

    const data = await res.json() as { run_id: string };
    return data.run_id;
  } catch (err) {
    console.error(`Failed to create tool run:`, err);
    return null;
  }
}

async function updateToolRun(
  runId: string,
  update: {
    status: string;
    leads_found?: number;
    leads_new?: number;
    error_message?: string;
    log?: string;
  }
): Promise<void> {
  try {
    await fetch(config.toolRuns.apiUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.toolRuns.apiKey,
      },
      body: JSON.stringify({ run_id: runId, ...update }),
    });
  } catch (err) {
    console.error(`Failed to update tool run:`, err);
  }
}

// --- Base Tool ---

const MAX_EXECUTION_MS = 15 * 60 * 1000; // 15 minutes hard timeout

export abstract class BaseTool {
  protected toolSlug: string;
  protected city: string;
  protected dryRun: boolean;
  protected log: Logger;

  constructor(options: ToolRunOptions) {
    this.toolSlug = options.toolSlug;
    this.city = options.city;
    this.dryRun = options.dryRun ?? false;
    this.log = createLogger(options.toolSlug);
  }

  /**
   * Override this in each tool implementation.
   */
  abstract run(city: CityConfig): Promise<ToolRunReport>;

  /**
   * Execute the tool with lifecycle management.
   * Creates a tool run record, executes, and reports results.
   */
  async execute(city: CityConfig): Promise<ToolRunReport> {
    const startedAt = new Date();
    this.log.info(`Starting run for ${city.name}`, { dryRun: this.dryRun });

    // Create tool run in backend
    const runId = await createToolRun(this.toolSlug);
    if (runId) {
      this.log.debug(`Tool run created`, { runId });
    } else {
      this.log.warn(`Could not create tool run record – continuing without tracking`);
    }

    // Graceful shutdown on SIGTERM (Railway container stop)
    const onSigterm = async () => {
      this.log.warn('SIGTERM received – marking run as error');
      if (runId) {
        await updateToolRun(runId, {
          status: 'error',
          error_message: 'Process killed (SIGTERM)',
        });
      }
      process.exit(1);
    };
    process.on('SIGTERM', onSigterm);

    // Hard timeout to prevent zombie runs
    const timeoutId = setTimeout(async () => {
      this.log.error(`Execution timeout reached (${MAX_EXECUTION_MS / 1000}s)`);
      if (runId) {
        await updateToolRun(runId, {
          status: 'error',
          error_message: `Execution timeout (${MAX_EXECUTION_MS / 60000}min)`,
        });
      }
      process.exit(1);
    }, MAX_EXECUTION_MS);
    timeoutId.unref();

    try {
      await loadCities();
      const report = await this.run(city);
      const finishedAt = new Date();

      report.startedAt = startedAt;
      report.finishedAt = finishedAt;
      report.durationMs = finishedAt.getTime() - startedAt.getTime();

      // Update tool run in backend
      if (runId) {
        await updateToolRun(runId, {
          status: report.status === 'failed' ? 'error' : 'success',
          leads_found: report.leadsFound,
          leads_new: report.leadsNew,
          error_message: report.errors.length > 0 ? report.errors.join('; ') : undefined,
        });
      }

      this.log.info(`Run completed`, {
        status: report.status,
        found: report.leadsFound,
        new: report.leadsNew,
        pushed: report.leadsPushed,
        durationMs: report.durationMs,
      });

      return report;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Run failed: ${errorMsg}`);

      if (runId) {
        await updateToolRun(runId, {
          status: 'error',
          error_message: errorMsg,
        });
      }

      return {
        toolSlug: this.toolSlug,
        city: city.slug,
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        leadsFound: 0,
        leadsNew: 0,
        leadsPushed: 0,
        errors: [errorMsg],
        status: 'failed',
      };
    } finally {
      clearTimeout(timeoutId);
      process.removeListener('SIGTERM', onSigterm);
    }
  }
}
