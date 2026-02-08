import type { DSN } from '@logtide/types';

/**
 * Parse a LogTide DSN string into its components.
 * Format: https://lp_APIKEY@host
 * Legacy format with path (https://lp_APIKEY@host/PROJECT_ID) is also accepted; the path is ignored.
 */
export function parseDSN(dsn: string): DSN {
  try {
    const url = new URL(dsn);
    const apiKey = url.username;
    const apiUrl = `${url.protocol}//${url.host}`;

    if (!apiKey) {
      throw new Error('Missing API key in DSN');
    }

    return { apiUrl, apiKey };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Missing')) {
      throw err;
    }
    throw new Error(`Invalid DSN: ${dsn}`);
  }
}
