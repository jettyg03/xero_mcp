/**
 * Xero OAuth 2.0 authentication and token management.
 * Supports multi-tenant (per-tenantId) token storage and automatic refresh.
 * Linear: BEN-15, BEN-44.
 */

import type { XeroTokenSet } from "./types.js";
import { createTokenStoreFromEnv } from "./token-store.js";
import { z } from "zod";

const XERO_AUTH_URL =
  "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

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

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const connectionsResponseSchema = z.array(
  z.object({
    id: z.string().optional(),
    tenantId: z.string().optional(),
    tenantName: z.string().optional(),
    tenantType: z.string().optional(),
    createdDateUtc: z.string().optional(),
    updatedDateUtc: z.string().optional(),
  })
);

// ---------------------------------------------------------------------------
// Token store keyed by tenantId (encrypted-at-rest when configured).
// ---------------------------------------------------------------------------
const tokenStore = createTokenStoreFromEnv();

/** In-flight refresh de-dupe per tenantId. */
const refreshInFlight = new Map<string, Promise<XeroTokenSet>>();

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

export type XeroTokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/**
 * Exchange an OAuth authorisation code for an access/refresh token pair.
 *
 * Note: Xero's tenant selection is not part of the token exchange response.
 * To discover the tenant(s) the token is authorised for, call `listConnections`
 * with the returned access token and then store the token set under the chosen
 * `tenantId` via `storeToken`.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<XeroTokenExchangeResult> {
  const raw = await tokenRequest(clientId, clientSecret, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000,
  };
}

/**
 * Convenience helper for environments that already know the target `tenantId`.
 */
export async function exchangeCodeForTokenAndStore(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  tenantId: string
): Promise<XeroTokenSet> {
  const exchanged = await exchangeCodeForToken(
    code,
    redirectUri,
    clientId,
    clientSecret
  );
  const token: XeroTokenSet = { ...exchanged, tenantId };
  storeToken(token);
  return token;
}

export function storeToken(token: XeroTokenSet): void {
  tokenStore.set(token);
}

export function hasToken(tenantId: string): boolean {
  return tokenStore.has(tenantId);
}

export function listTokenTenants(): string[] {
  return tokenStore.listTenantIds();
}

export interface XeroConnection {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
}

/**
 * List connected Xero tenants for the current access token.
 * Useful for onboarding to discover the `tenantId` value to store against.
 */
export async function listConnections(accessToken: string): Promise<XeroConnection[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Xero connections request failed: ${res.status} ${text}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Xero connections response was not valid JSON: ${text}`);
  }

  const parsed = connectionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Xero connections response did not match expected shape: ${parsed.error.message}`
    );
  }

  return parsed.data.map((c) => ({
    id: c.id ?? "",
    tenantId: c.tenantId ?? "",
    tenantName: c.tenantName ?? "",
    tenantType: c.tenantType ?? "",
    createdDateUtc: c.createdDateUtc,
    updatedDateUtc: c.updatedDateUtc,
  }));
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
      `No token found for tenant "${tenantId}". Onboard this tenant via the Xero OAuth flow first.`
    );
  }

  if (Date.now() >= token.expiresAt - REFRESH_TOKEN_BUFFER_MS) {
    const existing = refreshInFlight.get(tenantId);
    const refreshPromise =
      existing ??
      doRefresh(tenantId, token.refreshToken, clientId, clientSecret).finally(
        () => refreshInFlight.delete(tenantId)
      );
    if (!existing) refreshInFlight.set(tenantId, refreshPromise);
    const refreshed = await refreshPromise;
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

  tokenStore.set(refreshed);
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

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Xero token request failed: ${res.status} ${text}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Xero token response was not valid JSON: ${text}`);
  }

  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Xero token response did not match expected shape: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
