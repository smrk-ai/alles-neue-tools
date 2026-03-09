import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('meta-client');

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';
const RATE_LIMIT_DELAY_MS = 500;
const RETRY_ATTEMPTS = 1;
const RETRY_DELAY_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let rateLimitChain = Promise.resolve();

// --- Error Class ---

export class MetaApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public errorCode?: number,
    public errorSubcode?: number,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  get isTokenExpired(): boolean {
    return this.errorCode === 190;
  }

  get isRateLimited(): boolean {
    return (
      this.errorCode === 4 ||
      this.errorCode === 17 ||
      this.errorCode === 32 ||
      this.httpStatus === 429
    );
  }
}

// --- Rate Limiting ---

function enforceRateLimit(): Promise<void> {
  rateLimitChain = rateLimitChain.then(() => sleep(RATE_LIMIT_DELAY_MS));
  return rateLimitChain;
}

// --- Core GET ---

export async function graphApiGet<T>(
  endpoint: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  await enforceRateLimit();

  const url = new URL(`${GRAPH_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('access_token', token);

  log.debug(`GET ${endpoint}`, { params: Object.keys(params) });

  const response = await fetch(url.toString());

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = body?.error;
    throw new MetaApiError(
      err?.message || `Graph API error: ${response.status}`,
      response.status,
      err?.code,
      err?.error_subcode,
    );
  }

  return response.json() as Promise<T>;
}

// --- Paginated GET ---

interface PaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

export async function graphApiGetPaginated<T>(
  endpoint: string,
  params: Record<string, string>,
  token: string,
  maxPages: number = 5,
): Promise<T[]> {
  const allItems: T[] = [];
  let nextUrl: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let result: PaginatedResponse<T>;

    if (nextUrl) {
      // Follow the full next URL (includes access_token)
      await enforceRateLimit();
      log.debug(`GET page ${page + 1} (paginated)`);
      const response = await fetch(nextUrl);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const err = body?.error;
        throw new MetaApiError(
          err?.message || `Graph API pagination error: ${response.status}`,
          response.status,
          err?.code,
          err?.error_subcode,
        );
      }
      result = (await response.json()) as PaginatedResponse<T>;
    } else {
      result = await graphApiGet<PaginatedResponse<T>>(
        endpoint,
        params,
        token,
      );
    }

    if (result.data) {
      allItems.push(...result.data);
    }

    if (!result.paging?.next) break;
    nextUrl = result.paging.next;
  }

  return allItems;
}

// --- Retry Wrapper ---

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
): Promise<T> {
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts) throw error;

      if (error instanceof MetaApiError && error.isRateLimited) {
        const delay = RETRY_DELAY_MS * (i + 1) * 2;
        log.warn(`Rate limited, retrying in ${delay}ms...`);
        await sleep(delay);
      } else if (error instanceof MetaApiError && error.httpStatus >= 500) {
        const delay = RETRY_DELAY_MS * (i + 1);
        log.warn(`Server error ${error.httpStatus}, retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Unreachable');
}

// --- Token Inspection ---

interface TokenDebugData {
  app_id: string;
  type: string;
  is_valid: boolean;
  expires_at: number; // Unix timestamp, 0 = never
  scopes: string[];
  user_id?: string;
}

export async function inspectToken(token: string): Promise<{
  isValid: boolean;
  expiresAt: Date | null;
  daysRemaining: number | null;
  scopes: string[];
  userId?: string;
}> {
  const appToken = `${config.meta.appId}|${config.meta.appSecret}`;

  const result = await graphApiGet<{ data: TokenDebugData }>(
    'debug_token',
    { input_token: token },
    appToken,
  );

  const data = result.data;
  const expiresAt =
    data.expires_at === 0 ? null : new Date(data.expires_at * 1000);
  const daysRemaining =
    expiresAt === null
      ? null
      : Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return {
    isValid: data.is_valid,
    expiresAt,
    daysRemaining,
    scopes: data.scopes || [],
    userId: data.user_id,
  };
}
