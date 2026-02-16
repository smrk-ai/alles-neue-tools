import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

export const config = {
  pipeline: {
    apiUrl: requireEnv('PIPELINE_API_URL'),
    apiKey: requireEnv('PIPELINE_API_KEY'),
  },
  toolRuns: {
    apiUrl: requireEnv('TOOL_RUNS_API_URL'),
    apiKey: requireEnv('TOOL_API_KEY'),
  },
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },
  google: {
    placesApiKey: optionalEnv('GOOGLE_PLACES_API_KEY'),
  },
  meta: {
    appId: optionalEnv('META_APP_ID'),
    appSecret: optionalEnv('META_APP_SECRET'),
    userToken: optionalEnv('META_USER_ACCESS_TOKEN'),
    instagramToken: optionalEnv('META_INSTAGRAM_TOKEN'),
    instagramUserId: optionalEnv('META_INSTAGRAM_USER_ID'),
    pageToken: optionalEnv('META_PAGE_ACCESS_TOKEN'),
    pageId: optionalEnv('META_PAGE_ID'),
  },
  foursquare: {
    apiKey: optionalEnv('FOURSQUARE_API_KEY'),
  },
  env: (optionalEnv('TOOL_ENV', 'development') as 'development' | 'production'),
} as const;

export type AppConfig = typeof config;
