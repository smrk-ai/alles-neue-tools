import { errorToString } from './utils.js';
import { config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { loadCities } from './city-config.js';
import { getSupabaseClient } from './supabase-client.js';
import type { CityConfig, ToolRunOptions, ToolRunReport } from './types.js';

// --- Tool Runs API Client ---

const toolRunLog = createLogger('tool-runs');

/**
 * Check if a tool is already running (started within last 20 minutes).
 * Prevents duplicate runs when run-all and individual crons overlap.
 */
async function isToolAlreadyRunning(toolSlug: string): Promise<boolean> {
  try {
    const db = getSupabaseClient();

    // Look up tool_id from tool_configs
    const { data: toolConfig, error: configError } = await db
      .from('tool_configs')
      .select('id')
      .eq('slug', toolSlug)
      .single();

    if (configError || !toolConfig) {
      toolRunLog.warn(`Lock check: tool config not found for "${toolSlug}"`);
      return false;
    }

    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const { data, error } = await db
      .from('tool_runs')
      .select('id')
      .eq('tool_id', toolConfig.id)
      .eq('status', 'running')
      .gte('started_at', twentyMinutesAgo)
      .limit(1);

    if (error) {
      toolRunLog.warn(`Lock check failed: ${error.message}`);
      return false;
    }

    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function createToolRun(toolSlug: string): Promise<string | null> {
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
      toolRunLog.error(`Failed to create tool run (${res.status}): ${body}`);
      return null;
    }

    const data = await res.json() as { run_id: string };
    return data.run_id;
  } catch (err) {
    toolRunLog.error(`Failed to create tool run`, { error: errorToString(err) });
    return null;
  }
}

export async function updateToolRun(
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
    toolRunLog.error(`Failed to update tool run`, { error: errorToString(err) });
  }
}

// --- Base Tool ---

// Hard timeout to prevent zombie runs. Configurable via TOOL_MAX_EXECUTION_MIN
// (default 30) so a one-off large initial scan can run longer locally without
// touching the Railway cron default.
const MAX_EXECUTION_MS = (() => {
  const min = Number(config.toolRuns.maxExecutionMin);
  return Number.isFinite(min) && min > 0 ? min * 60 * 1000 : 30 * 60 * 1000;
})();

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
   * Build a standardized ToolRunReport.
   * startedAt/finishedAt/durationMs are placeholders — execute() overwrites them.
   */
  protected buildReport(
    found: number,
    newCount: number,
    pushed: number,
    errors: string[],
  ): ToolRunReport {
    return {
      toolSlug: this.toolSlug,
      city: this.city,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      leadsFound: found,
      leadsNew: newCount,
      leadsPushed: pushed,
      errors,
      status: errors.length === 0 ? 'success' : 'partial',
    };
  }

  /**
   * Execute the tool with lifecycle management.
   * Creates a tool run record, executes, and reports results.
   */
  async execute(city: CityConfig): Promise<ToolRunReport> {
    // Lock-Check: Verhindert Duplikat-Runs (run-all + Einzel-Cron gleichzeitig)
    const alreadyRunning = await isToolAlreadyRunning(this.toolSlug);
    if (alreadyRunning) {
      this.log.warn(`Tool "${this.toolSlug}" is already running — aborting to prevent duplicate run`);
      return {
        toolSlug: this.toolSlug,
        city: city.slug,
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
        leadsFound: 0,
        leadsNew: 0,
        leadsPushed: 0,
        errors: ['Aborted: duplicate run detected'],
        status: 'failed',
      };
    }

    const startedAt = new Date();
    this.log.info(`Starting run for ${city.name}`, { dryRun: this.dryRun });

    // Create tool run in backend
    const runId = await createToolRun(this.toolSlug);
    if (runId) {
      this.log.debug(`Tool run created`, { runId });
    } else {
      this.log.warn(`Could not create tool run record – continuing without tracking`);
    }

    // Guard to prevent race between SIGTERM and timeout
    let exiting = false;
    const exitWithReport = (errorMessage: string) => {
      if (exiting) return;
      exiting = true;
      const done = runId
        ? updateToolRun(runId, { status: 'error', error_message: errorMessage })
        : Promise.resolve();
      // Give 3s for the API call, then force exit
      const deadline = new Promise<void>((r) => setTimeout(r, 3000));
      Promise.race([done, deadline]).finally(() => process.exit(1));
    };

    // Graceful shutdown on SIGTERM (Railway container stop)
    const onSigterm = () => {
      this.log.warn('SIGTERM received – marking run as error');
      exitWithReport('Process killed (SIGTERM)');
    };
    process.on('SIGTERM', onSigterm);

    // Hard timeout to prevent zombie runs
    const timeoutId = setTimeout(() => {
      this.log.error(`Execution timeout reached (${MAX_EXECUTION_MS / 1000}s)`);
      exitWithReport(`Execution timeout (${MAX_EXECUTION_MS / 60000}min)`);
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
      const errorMsg = errorToString(err);
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
