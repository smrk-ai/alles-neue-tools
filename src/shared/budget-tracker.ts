import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from './logger.js';
import type { ApiSku, BudgetStatus, DetailTier } from './types.js';

const log = createLogger('budget-tracker');

// SKU config: limits and costs per call (above free tier)
const SKU_CONFIG: Record<ApiSku, { limit: number; safety: number; costPerCall: number }> = {
  text_search_ids_only:     { limit: 999999, safety: 999999, costPerCall: 0 },
  place_details_pro:        { limit: 5000,   safety: 4500,   costPerCall: 0.017 },
  place_details_essentials: { limit: 10000,  safety: 9000,   costPerCall: 0.007 },
};

// Tier order for detail fetching (best data first)
// These values are the intersection of ApiSku and DetailTier (excluding 'queued')
const DETAIL_TIER_ORDER = [
  'place_details_pro',
  'place_details_essentials',
] as const satisfies readonly (ApiSku & DetailTier)[];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function toBudgetStatus(sku: ApiSku, month: string, used: number, limit: number, safety: number): BudgetStatus {
  const remaining = safety - used;
  return {
    sku,
    month,
    callsUsed: used,
    callsLimit: limit,
    callsSafety: safety,
    remaining: Math.max(0, remaining),
    exhausted: remaining <= 0,
    usagePercent: used === 0 ? 0 : Math.round((used / safety) * 100),
  };
}

/**
 * Get budget status for a SKU in the current month.
 * Auto-creates the entry if it doesn't exist yet.
 */
export async function getBudgetStatus(toolSlug: string, sku: ApiSku): Promise<BudgetStatus> {
  const db = getSupabaseClient();
  const month = getCurrentMonth();
  const skuConfig = SKU_CONFIG[sku];

  // Try to read existing entry first
  const { data: existing } = await db
    .from('api_budget_usage')
    .select('calls_used, calls_limit, calls_safety')
    .eq('tool_slug', toolSlug)
    .eq('sku', sku)
    .eq('month', month)
    .single();

  if (existing) {
    return toBudgetStatus(sku, month, existing.calls_used, existing.calls_limit, existing.calls_safety);
  }

  // Create new entry for this month
  const { error: insertError } = await db
    .from('api_budget_usage')
    .insert({
      tool_slug: toolSlug,
      sku,
      month,
      calls_used: 0,
      calls_limit: skuConfig.limit,
      calls_safety: skuConfig.safety,
      cost_per_call: skuConfig.costPerCall,
      estimated_cost: 0,
    });

  if (insertError) {
    // Race condition: another process created it — read again
    const { data: retry } = await db
      .from('api_budget_usage')
      .select('calls_used, calls_limit, calls_safety')
      .eq('tool_slug', toolSlug)
      .eq('sku', sku)
      .eq('month', month)
      .single();

    if (retry) {
      return toBudgetStatus(sku, month, retry.calls_used, retry.calls_limit, retry.calls_safety);
    }

    throw new Error(`Budget status unavailable for ${toolSlug}/${sku}/${month}`);
  }

  return toBudgetStatus(sku, month, 0, skuConfig.limit, skuConfig.safety);
}

/**
 * Increment the call counter. Called AFTER a successful API call.
 * Returns false if budget is exhausted (call should not have been made).
 */
export async function incrementBudget(toolSlug: string, sku: ApiSku, count: number = 1): Promise<boolean> {
  const status = await getBudgetStatus(toolSlug, sku);

  if (status.exhausted) {
    log.warn(`Budget exhausted for ${sku} (${status.callsUsed}/${status.callsSafety} in ${status.month})`);
    return false;
  }

  const db = getSupabaseClient();
  const month = getCurrentMonth();

  const newUsed = status.callsUsed + count;
  const overFree = Math.max(0, newUsed - status.callsLimit);
  const skuConfig = SKU_CONFIG[sku];
  const estimatedCost = overFree * skuConfig.costPerCall;

  const { error } = await db
    .from('api_budget_usage')
    .update({
      calls_used: newUsed,
      estimated_cost: estimatedCost,
      updated_at: new Date().toISOString(),
    })
    .eq('tool_slug', toolSlug)
    .eq('sku', sku)
    .eq('month', month);

  if (error) {
    log.error(`Failed to increment budget for ${sku}`, { error: error.message });
    return false;
  }

  // Warning at 80%+ usage
  const newPercent = Math.round((newUsed / status.callsSafety) * 100);
  if (newPercent >= 80 && status.usagePercent < 80) {
    log.warn(`Budget warning: ${sku} at ${newPercent}% (${newUsed}/${status.callsSafety})`);
  }

  return true;
}

/**
 * Check budget BEFORE making an API call.
 * Returns false if budget is exhausted.
 */
export async function canMakeCall(toolSlug: string, sku: ApiSku): Promise<boolean> {
  const status = await getBudgetStatus(toolSlug, sku);
  return !status.exhausted;
}

/**
 * Determine the best available tier for detail fetching.
 * Returns 'queued' if all tiers are exhausted.
 */
export async function getAvailableDetailTier(toolSlug: string): Promise<DetailTier> {
  for (const tier of DETAIL_TIER_ORDER) {
    const status = await getBudgetStatus(toolSlug, tier);
    if (!status.exhausted) {
      log.debug(`Available tier: ${tier} (${status.remaining} remaining)`);
      return tier;
    }
    log.info(`Tier ${tier} exhausted (${status.callsUsed}/${status.callsSafety})`);
  }

  log.warn(`All detail tiers exhausted — queuing for next month`);
  return 'queued';
}

/**
 * Get budget overview for all SKUs of a tool in the current month.
 * Used by admin dashboard.
 */
export async function getAllBudgetStatuses(toolSlug: string): Promise<BudgetStatus[]> {
  const statuses: BudgetStatus[] = [];
  for (const tier of DETAIL_TIER_ORDER) {
    statuses.push(await getBudgetStatus(toolSlug, tier));
  }
  return statuses;
}
