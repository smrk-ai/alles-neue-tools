import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { findNew, markKnown } from '../shared/delta-store.js';
import { checkAllTokens } from '../shared/token-refresh.js';
import type { CityConfig, ToolRunReport } from '../shared/types.js';
import { searchHashtag } from './hashtag-monitor.js';
import { analyzePost } from './post-analyzer.js';
import { transformToLead } from './lead-transformer.js';
import {
  loadRotationState,
  saveRotationState,
  getHashtagsForToday,
  getQuotaStatus,
  markUsed,
} from './hashtag-rotation.js';
import type { InstagramPost, InstagramToolOptions, PostAnalysisResult } from './types.js';

const TOOL_SLUG = 'instagram-scout';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Tool Class ---

export class InstagramScoutTool extends BaseTool {
  private checkTokens: boolean;
  private showQuota: boolean;

  constructor(options: InstagramToolOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.checkTokens = options.checkTokens;
    this.showQuota = options.quota;
  }

  async run(city: CityConfig): Promise<ToolRunReport> {
    // Step 1: Load rotation state
    let rotationState = await loadRotationState();

    // Show quota status if requested
    if (this.showQuota) {
      const quota = getQuotaStatus(rotationState);
      console.log('\n--- Instagram Hashtag Quota ---');
      console.log(`Week:      ${quota.weekId}`);
      console.log(`Used:      ${quota.used}/30`);
      console.log(`Remaining: ${quota.remaining}`);
      if (quota.usedTags.length > 0) {
        console.log(`Tags used: ${quota.usedTags.join(', ')}`);
      }
      return this.buildReport(0, 0, 0, []);
    }

    // Step 2: Check tokens (optional)
    if (this.checkTokens) {
      const statuses = await checkAllTokens();
      for (const s of statuses) {
        if (s.warning) {
          this.log.warn(`${s.name}: ${s.warning}`);
        }
      }
    }

    // Step 3: Get today's hashtags
    const hashtags = getHashtagsForToday(rotationState);
    this.log.info(
      `Today's hashtags (${hashtags.length}): ${hashtags.map((h) => '#' + h.tag).join(', ')}`,
    );

    if (hashtags.length === 0) {
      this.log.info('No hashtags to search today (quota exhausted). Done.');
      return this.buildReport(0, 0, 0, []);
    }

    // Step 4: Search hashtags
    const allPosts: Array<{ post: InstagramPost; hashtag: string }> = [];
    const errors: string[] = [];
    const seenPostIds = new Set<string>();

    for (const hashtag of hashtags) {
      try {
        const posts = await searchHashtag(hashtag.tag);
        for (const post of posts) {
          if (!seenPostIds.has(post.id)) {
            seenPostIds.add(post.id);
            allPosts.push({ post, hashtag: hashtag.tag });
          }
        }
      } catch (error) {
        const msg = `#${hashtag.tag}: ${error instanceof Error ? error.message : error}`;
        this.log.warn(msg);
        errors.push(msg);
      }
      await sleep(500);
    }

    this.log.info(
      `Fetched ${allPosts.length} unique posts from ${hashtags.length} hashtags`,
    );

    // Step 5: Analyze posts
    const analyses: Array<{
      post: InstagramPost;
      analysis: PostAnalysisResult;
      hashtag: string;
    }> = [];

    for (const { post, hashtag } of allPosts) {
      const analysis = analyzePost(post);
      if (analysis.isLikelyNewBusiness) {
        analyses.push({ post, analysis, hashtag });
      }
    }

    this.log.info(
      `${analyses.length} posts flagged as potential new businesses (of ${allPosts.length} total)`,
    );

    // Step 6: Delta detection
    const entries = analyses.map((a) => ({
      source: 'instagram' as const,
      sourceId: `ig_post_${a.post.id}`,
    }));

    const newEntries = await findNew(entries);
    const newIds = new Set(newEntries.map((e) => e.sourceId));
    const newAnalyses = analyses.filter(
      (a) => newIds.has(`ig_post_${a.post.id}`),
    );

    this.log.info(
      `Delta: ${analyses.length} candidates, ${analyses.length - newAnalyses.length} known, ${newAnalyses.length} NEW`,
    );

    // Update rotation state (even in dry-run, we track quota usage)
    rotationState = markUsed(rotationState, hashtags);
    await saveRotationState(rotationState);

    if (newAnalyses.length === 0) {
      this.log.info('No new leads. Done.');
      return this.buildReport(allPosts.length, 0, 0, errors);
    }

    // Step 7: Dry-run check
    if (this.dryRun) {
      this.log.info(
        `Dry run: ${newAnalyses.length} new leads found. ` +
          `Would transform and push to pipeline.`,
      );
      for (const { post, analysis, hashtag } of newAnalyses) {
        this.log.info(
          `  #${hashtag} → "${analysis.extractedInfo.possibleName || '(unnamed)'}" ` +
            `(confidence: ${(analysis.confidence * 100).toFixed(0)}%) ` +
            `${post.permalink}`,
        );
      }
      return this.buildReport(
        allPosts.length,
        newAnalyses.length,
        0,
        errors,
      );
    }

    // Step 8: Transform to leads
    const leads = newAnalyses.map(({ post, analysis, hashtag }) =>
      transformToLead(post, analysis, hashtag, city.name),
    );

    // Step 9: Push to pipeline
    const results = await pushLeads(leads);
    const pushedCount = results.filter((r) => r.success).length;

    // Step 10: Mark as known in delta store
    await markKnown(
      newAnalyses.map(({ post, analysis }) => ({
        source: 'instagram' as const,
        sourceId: `ig_post_${post.id}`,
        city: city.name,
        cityId: city.id,
        name: analysis.extractedInfo.possibleName || undefined,
      })),
    );

    // Step 11: Build report
    return this.buildReport(
      allPosts.length,
      newAnalyses.length,
      pushedCount,
      errors,
    );
  }

  private buildReport(
    found: number,
    newCount: number,
    pushed: number,
    errors: string[],
  ): ToolRunReport {
    return {
      toolSlug: TOOL_SLUG,
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
}

/** Factory for orchestrator usage */
export function createTool(options: { city: string; dryRun?: boolean }): InstagramScoutTool {
  return new InstagramScoutTool({ ...options, dryRun: options.dryRun ?? false, checkTokens: false, quota: false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): InstagramToolOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'hoi-an',
    dryRun: args.includes('--dry-run'),
    quota: args.includes('--quota'),
    checkTokens: args.includes('--check-tokens'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const options = parseArgs();

  const city = getCityBySlug(options.city);
  if (!city) {
    console.error(
      `Unknown city: "${options.city}". Available: hoi-an, da-nang`,
    );
    process.exit(1);
  }

  if (options.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  const tool = new InstagramScoutTool(options);
  const report = await tool.execute(city);

  if (!options.quota) {
    console.log('\n--- Instagram Scout Summary ---');
    console.log(`Status:       ${report.status}`);
    console.log(`Posts found:  ${report.leadsFound}`);
    console.log(`New leads:    ${report.leadsNew}`);
    console.log(`Leads pushed: ${report.leadsPushed}`);
    console.log(`Duration:     ${(report.durationMs / 1000).toFixed(1)}s`);
    if (report.errors.length > 0) {
      console.log(`Errors:       ${report.errors.length}`);
    }
  }

  process.exit(report.status === 'failed' ? 1 : 0);
}

// Only run CLI when executed directly, not when imported as module
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
