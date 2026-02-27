/**
 * Environment configuration for R&D Tax AI MCP server.
 * Reads all secrets from process.env — never hardcode credentials.
 * Copy .env.example → .env and populate before running locally.
 * Linear: BEN-13 (secrets management).
 */

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env and populate it.`
    );
  }
  return value;
}

function optional(key: string, defaultValue = ""): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  xero: {
    clientId: required("XERO_CLIENT_ID"),
    clientSecret: required("XERO_CLIENT_SECRET"),
    redirectUri: optional(
      "XERO_REDIRECT_URI",
      "http://localhost:3000/callback"
    ),
  },
  search: {
    apiKey: optional("WEB_SEARCH_API_KEY"),
  },
  /** Tenant / client isolation — each client may supply their own credentials at runtime. */
  tenantId: optional("XERO_TENANT_ID"),
} as const;

export type Config = typeof config;
