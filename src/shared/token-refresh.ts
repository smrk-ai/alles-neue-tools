import { config } from './config.js';
import { createLogger } from './logger.js';
import { graphApiGet, inspectToken } from './meta-client.js';

const log = createLogger('token-refresh');

// --- Token Check ---

export interface TokenStatus {
  name: string;
  isValid: boolean;
  expiresAt: Date | null;
  daysRemaining: number | null;
  scopes: string[];
  warning: string | null;
}

export async function checkAllTokens(): Promise<TokenStatus[]> {
  const results: TokenStatus[] = [];

  // User Token
  if (config.meta.userToken) {
    try {
      const info = await inspectToken(config.meta.userToken);
      results.push({
        name: 'User Token',
        isValid: info.isValid,
        expiresAt: info.expiresAt,
        daysRemaining: info.daysRemaining,
        scopes: info.scopes,
        warning:
          info.daysRemaining !== null && info.daysRemaining < 7
            ? `Expires in ${info.daysRemaining} days! Run --refresh soon.`
            : null,
      });
    } catch (error) {
      results.push({
        name: 'User Token',
        isValid: false,
        expiresAt: null,
        daysRemaining: null,
        scopes: [],
        warning: `Check failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  // Instagram Token
  if (config.meta.instagramToken) {
    try {
      const info = await inspectToken(config.meta.instagramToken);
      results.push({
        name: 'Instagram Token',
        isValid: info.isValid,
        expiresAt: info.expiresAt,
        daysRemaining: info.daysRemaining,
        scopes: info.scopes,
        warning:
          info.daysRemaining !== null && info.daysRemaining < 7
            ? `Expires in ${info.daysRemaining} days! Run --refresh soon.`
            : null,
      });
    } catch (error) {
      results.push({
        name: 'Instagram Token',
        isValid: false,
        expiresAt: null,
        daysRemaining: null,
        scopes: [],
        warning: `Check failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  // Page Token (permanent)
  if (config.meta.pageToken) {
    try {
      const info = await inspectToken(config.meta.pageToken);
      results.push({
        name: 'Page Token',
        isValid: info.isValid,
        expiresAt: info.expiresAt,
        daysRemaining: info.daysRemaining,
        scopes: info.scopes,
        warning: null,
      });
    } catch (error) {
      results.push({
        name: 'Page Token',
        isValid: false,
        expiresAt: null,
        daysRemaining: null,
        scopes: [],
        warning: `Check failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  return results;
}

// --- Token Refresh ---

export async function refreshUserToken(): Promise<string> {
  if (!config.meta.appId || !config.meta.appSecret) {
    throw new Error(
      'META_APP_ID and META_APP_SECRET required for token refresh',
    );
  }
  if (!config.meta.userToken) {
    throw new Error('META_USER_ACCESS_TOKEN required for refresh');
  }

  log.info('Refreshing User Token...');

  const result = await graphApiGet<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>(
    'oauth/access_token',
    {
      grant_type: 'fb_exchange_token',
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: config.meta.userToken,
    },
    config.meta.userToken,
  );

  const daysValid = Math.floor(result.expires_in / 86400);
  log.info(`New User Token valid for ${daysValid} days`);

  return result.access_token;
}

export async function refreshInstagramToken(): Promise<string> {
  if (!config.meta.instagramToken) {
    throw new Error('META_INSTAGRAM_TOKEN required for refresh');
  }

  log.info('Refreshing Instagram Token...');

  const result = await graphApiGet<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>(
    'refresh_access_token',
    {
      grant_type: 'ig_refresh_token',
      access_token: config.meta.instagramToken,
    },
    config.meta.instagramToken,
  );

  const daysValid = Math.floor(result.expires_in / 86400);
  log.info(`New Instagram Token valid for ${daysValid} days`);

  return result.access_token;
}

// --- Utility: Check if any tokens need attention ---

export async function getTokenWarnings(): Promise<string[]> {
  const statuses = await checkAllTokens();
  return statuses
    .filter((s) => s.warning !== null)
    .map((s) => `${s.name}: ${s.warning}`);
}

// --- CLI Entry Point ---

function parseArgs(): { check: boolean; refresh: boolean; warnDays: number } {
  const args = process.argv.slice(2);
  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    check: args.includes('--check'),
    refresh: args.includes('--refresh'),
    warnDays: parseInt(flagValue('--warn-days') ?? '7', 10),
  };
}

async function main() {
  const args = parseArgs();

  if (!args.check && !args.refresh) {
    console.log('Usage:');
    console.log(
      '  npx tsx src/shared/token-refresh.ts --check             Check all tokens',
    );
    console.log(
      '  npx tsx src/shared/token-refresh.ts --refresh           Refresh expiring tokens',
    );
    console.log(
      '  npx tsx src/shared/token-refresh.ts --check --warn-days 10',
    );
    process.exit(0);
  }

  if (args.check) {
    console.log('\n--- Meta Token Status ---\n');
    const statuses = await checkAllTokens();

    for (const status of statuses) {
      const icon = status.isValid ? '✅' : '❌';
      const expiry =
        status.daysRemaining === null
          ? '(permanent)'
          : `(expires in ${status.daysRemaining} days)`;
      console.log(`${icon} ${status.name}: ${status.isValid ? 'Valid' : 'Invalid'} ${expiry}`);
      if (status.scopes.length > 0) {
        console.log(`   Scopes: ${status.scopes.join(', ')}`);
      }
      if (status.warning) {
        console.log(`   ⚠️  ${status.warning}`);
      }
    }

    // Exit with error if any token expires within warnDays
    const expiringSoon = statuses.filter(
      (s) => s.daysRemaining !== null && s.daysRemaining < args.warnDays,
    );
    if (expiringSoon.length > 0) {
      console.log(
        `\n⚠️  ${expiringSoon.length} token(s) expiring within ${args.warnDays} days!`,
      );
      process.exit(1);
    }
  }

  if (args.refresh) {
    console.log('\n--- Refreshing Tokens ---\n');

    try {
      const newUserToken = await refreshUserToken();
      console.log('✅ User Token refreshed.');
      console.log(`   New token: ${newUserToken.substring(0, 20)}...`);
      console.log('   → Update META_USER_ACCESS_TOKEN in .env');
    } catch (error) {
      console.log(
        `❌ User Token refresh failed: ${error instanceof Error ? error.message : error}`,
      );
    }

    try {
      const newIgToken = await refreshInstagramToken();
      console.log('✅ Instagram Token refreshed.');
      console.log(`   New token: ${newIgToken.substring(0, 20)}...`);
      console.log('   → Update META_INSTAGRAM_TOKEN in .env');
    } catch (error) {
      console.log(
        `❌ Instagram Token refresh failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
