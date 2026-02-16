import { createLogger } from '../shared/logger.js';
import { TIER_1_HASHTAGS, WEEKLY_SCHEDULE } from './config.js';
import type { HashtagConfig, RotationState } from './types.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const log = createLogger('ig-rotation');

const DATA_DIR = join(process.cwd(), '.data');
const STATE_FILE = join(DATA_DIR, 'instagram-rotation.json');

// --- Week ID ---

function getWeekId(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear =
    Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekNum = Math.ceil(dayOfYear / 7);
  return `${year}-W${weekNum.toString().padStart(2, '0')}`;
}

// --- State Persistence ---

export async function loadRotationState(): Promise<RotationState> {
  try {
    const data = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(data) as RotationState;

    // Reset if new week
    const currentWeek = getWeekId();
    if (state.weekId !== currentWeek) {
      log.info(`New week: ${state.weekId} → ${currentWeek}. Resetting quota.`);
      return { weekId: currentWeek, used: [] };
    }

    return state;
  } catch {
    // File doesn't exist yet
    return { weekId: getWeekId(), used: [] };
  }
}

export async function saveRotationState(
  state: RotationState,
): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  log.debug('Rotation state saved');
}

// --- Quota ---

export function getQuotaStatus(state: RotationState): {
  weekId: string;
  used: number;
  remaining: number;
  usedTags: string[];
} {
  const uniqueTags = new Set(state.used.map((u) => u.tag));
  return {
    weekId: state.weekId,
    used: uniqueTags.size,
    remaining: 30 - uniqueTags.size,
    usedTags: Array.from(uniqueTags),
  };
}

// --- Today's Hashtags ---

export function getHashtagsForToday(
  state: RotationState,
): HashtagConfig[] {
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ...
  const usedTags = new Set(state.used.map((u) => u.tag));
  const quota = getQuotaStatus(state);

  // Always include Tier 1 (daily)
  const todayHashtags: HashtagConfig[] = [...TIER_1_HASHTAGS];

  // Add scheduled tier 2/3/4 hashtags for today
  const scheduled = WEEKLY_SCHEDULE[dayOfWeek];
  if (scheduled) {
    todayHashtags.push(...scheduled);
  }

  // Filter out already-used hashtags that would exceed quota
  // Tier 1 tags that were already used this week don't count again
  const result: HashtagConfig[] = [];
  for (const hashtag of todayHashtags) {
    if (usedTags.has(hashtag.tag)) {
      // Already used this week — still search it but don't count toward quota
      result.push(hashtag);
    } else if (quota.remaining > 0) {
      result.push(hashtag);
      quota.remaining--;
    } else {
      log.warn(
        `Skipping #${hashtag.tag}: weekly quota exhausted (30/30)`,
      );
    }
  }

  return result;
}

// --- Mark Used ---

export function markUsed(
  state: RotationState,
  hashtags: HashtagConfig[],
): RotationState {
  const now = new Date().toISOString();
  const existingTags = new Set(state.used.map((u) => u.tag));

  const newUsed = hashtags
    .filter((h) => !existingTags.has(h.tag))
    .map((h) => ({ tag: h.tag, usedAt: now }));

  return {
    ...state,
    used: [...state.used, ...newUsed],
  };
}
