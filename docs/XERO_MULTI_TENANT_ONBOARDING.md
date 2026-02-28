# Xero multi-tenant onboarding (BEN-44)

This MCP server supports **per-call tenant selection** for `ingest_xero_data` by requiring a `tenantId` input parameter and retrieving OAuth tokens **scoped to that tenant** at call time.

Because the server runs over **stdio** (not HTTP), onboarding is an operational flow: an accountant/admin connects a client’s Xero organisation once, and the resulting OAuth tokens are stored securely for later ingestion calls.

## What you need

- **Xero OAuth app credentials (shared across all clients)**:
  - `XERO_CLIENT_ID`
  - `XERO_CLIENT_SECRET`
- **Encrypted token storage (required for persistence)**:
  - `XERO_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte key (AES-256-GCM)
  - `XERO_TOKEN_STORE_PATH` (optional): where the encrypted token file is written (default: `.xero_tokens.enc` in the working directory)

## Onboard a new client tenant (high level)

1. **Start the OAuth consent flow**
   - Generate an auth URL using `buildAuthUrl(clientId, redirectUri, state)` from `src/xero/auth.ts`.
   - The accountant logs in and approves access.

2. **Capture the authorisation `code`**
   - Xero redirects to your configured redirect URI with `?code=...&state=...`.

3. **Exchange `code` for tokens**
   - Call `exchangeCodeForToken(code, redirectUri, clientId, clientSecret, tenantId)`.
   - The token is stored **encrypted at rest** keyed by `tenantId`.

4. **Discover / confirm the `tenantId`**
   - Use `listConnections(accessToken)` to list connected tenants for the token and find the `tenantId` that corresponds to the client’s organisation.
   - Store the token under that `tenantId`.

## What gets stored

For each `tenantId`, the server stores:

- `accessToken`
- `refreshToken`
- `expiresAt` (ms since epoch)

These are persisted to disk only when `XERO_TOKEN_ENCRYPTION_KEY` is set; otherwise the server falls back to an in-memory store (tokens will be lost on restart).

## Runtime usage (ingestion)

When calling `ingest_xero_data`, the agent must pass the **client’s `tenantId`**:

```json
{
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "financialYear": 2024,
  "includeAttachments": true
}
```

At runtime the tool:

- Loads the correct token set for that `tenantId`
- Refreshes the token automatically when near expiry (per-tenant, de-duped for concurrent calls)
- Calls Xero Accounting + Attachments APIs using the `Xero-Tenant-Id` header

