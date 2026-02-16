import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { graphApiGet, withRetry } from '../shared/meta-client.js';
import type { InstagramPost } from './types.js';

const log = createLogger('ig-hashtag');

function getInstagramConfig(): { userId: string; token: string } {
  const userId = config.meta.instagramUserId;
  const token = config.meta.instagramToken;

  if (!userId) {
    throw new Error(
      'Missing META_INSTAGRAM_USER_ID. Set it in .env',
    );
  }
  if (!token) {
    throw new Error(
      'Missing META_INSTAGRAM_TOKEN. Set it in .env',
    );
  }

  return { userId, token };
}

// --- Hashtag ID Lookup ---

async function getHashtagId(
  tag: string,
  userId: string,
  token: string,
): Promise<string | null> {
  const result = await withRetry(() =>
    graphApiGet<{ data: Array<{ id: string }> }>(
      'ig_hashtag_search',
      { q: tag, user_id: userId },
      token,
    ),
  );

  if (!result.data?.[0]) {
    log.warn(`Hashtag #${tag} not found`);
    return null;
  }

  return result.data[0].id;
}

// --- Recent Media ---

const MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'permalink',
  'timestamp',
  'like_count',
  'comments_count',
].join(',');

async function getRecentMedia(
  hashtagId: string,
  userId: string,
  token: string,
): Promise<InstagramPost[]> {
  const result = await withRetry(() =>
    graphApiGet<{ data: InstagramPost[] }>(
      `${hashtagId}/recent_media`,
      { user_id: userId, fields: MEDIA_FIELDS },
      token,
    ),
  );

  return result.data || [];
}

// --- Combined Search ---

export async function searchHashtag(
  tag: string,
): Promise<InstagramPost[]> {
  const { userId, token } = getInstagramConfig();

  log.debug(`Searching #${tag}...`);

  const hashtagId = await getHashtagId(tag, userId, token);
  if (!hashtagId) return [];

  const posts = await getRecentMedia(hashtagId, userId, token);
  log.debug(`#${tag}: ${posts.length} recent posts`);

  return posts;
}
