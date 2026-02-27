/**
 * Xero OAuth 2.0 authentication and token management.
 * Supports multi-tenant (per-client) token storage and automatic refresh.
 * Linear: BEN-15.
 */

import type { XeroTokenSet } from "./types.js";

const XERO_AUTH_URL =
  "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.transactions",
  "accounting.attachments",
  "offline_access",
].join(" ");

/** Refresh token when access token has less than this many ms until expiry. */
const REFRESH_TOKEN_BUFFER_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory token store keyed by tenantId.
// Replace with a persistent, encrypted store (e.g. KMS-backed DB) in production.
// ---------------------------------------------------------------------------
const tokenStore = new Map<string, XeroTokenSet>();

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return `${XERO_AUTH_URL}?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  tenantId: string
): Promise<XeroTokenSet> {
  const raw = await tokenRequest(clientId, clientSecret, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const token: XeroTokenSet = {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000,
    tenantId,
  };

  tokenStore.set(tenantId, token);
  return token;
}

export function storeToken(token: XeroTokenSet): void {
  tokenStore.set(token.tenantId, token);
}

export function hasToken(tenantId: string): boolean {
  return tokenStore.has(tenantId);
}

/**
 * Returns a valid access token for the tenant, refreshing automatically
 * if the current token expires within 60 seconds.
 */
export async function getValidAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const token = tokenStore.get(tenantId);
  if (!token) {
    throw new Error(
      `No token found for tenant "${tenantId}". Complete the Xero OAuth flow first.`
    );
  }

  if (Date.now() >= token.expiresAt - REFRESH_TOKEN_BUFFER_MS) {
    const refreshed = await doRefresh(
      tenantId,
      token.refreshToken,
      clientId,
      clientSecret
    );
    return refreshed.accessToken;
  }

  return token.accessToken;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function doRefresh(
  tenantId: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<XeroTokenSet> {
  const raw = await tokenRequest(clientId, clientSecret, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const refreshed: XeroTokenSet = {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000,
    tenantId,
  };

  tokenStore.set(tenantId, refreshed);
  return refreshed;
}

async function tokenRequest(
  clientId: string,
  clientSecret: string,
  body: Record<string, string>
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
  });

  if (!res.ok) {
    throw new Error(
      `Xero token request failed: ${res.status} ${await res.text()}`
    );
  }

  return res.json();
}
