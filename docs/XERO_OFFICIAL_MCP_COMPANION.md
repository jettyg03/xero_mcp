# Official Xero MCP server (companion) — hybrid setup

Linear: **BEN-43**  
Related decision record: `docs/DECISION_RECORD_BEN-41_XERO_MCP_SERVER.md`

## Why a hybrid approach?

This repo’s custom tool `ingest_xero_data` is the **pipeline-safe** integration used for R&D Tax AI (transaction export + attachments + per-call tenant selection + structured JSON output).

The **official** Xero MCP server (from XeroAPI) exposes a broad set of ~40–50 tools that are useful for **ad-hoc / non-pipeline** work (account lookups, contacts, invoices, org details, etc.), but it does not meet the pipeline’s strict requirements.

## When to use which

- **Use `ingest_xero_data` (custom, this repo)** when you need:
  - FY (AU Jul–Jun) **transaction-level** export for categorisation
  - **Attachment retrieval** (receipts/invoices) via the Attachments API
  - **Per-call `tenantId` selection** (multi-tenant)
  - **Structured JSON** matching our internal ToolOutput contract (confidence + review flags)

- **Use the official Xero MCP server** when you need:
  - Broad Xero object access for **interactive queries**
  - “Lookup” style operations (e.g., list accounts, list contacts, list invoices)
  - Non-pipeline tasks where output shape and tenant scoping are acceptable

## Running the official server from this repo

This repo includes a small wrapper that runs the official server with **separate env vars** so credentials and tenant hints don’t conflict with the custom pipeline tooling.

### 1) Install dependencies

```bash
npm install
```

### 2) Configure env vars

Set **either**:

- Recommended (separate, no conflicts):
  - `XERO_OFFICIAL_CLIENT_ID`
  - `XERO_OFFICIAL_CLIENT_SECRET`
  - `XERO_OFFICIAL_REDIRECT_URI` (optional)
  - `XERO_OFFICIAL_TENANT_ID` (optional “hint”, if the official server supports it)

Or fallback (shared with custom server):

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI` (optional)

### 3) Start the official server (stdio MCP)

```bash
npm run official:xero
```

Under the hood this executes `scripts/run_official_xero_mcp.mjs`, which maps `XERO_OFFICIAL_*` → the env vars expected by the official server.

## Client configuration (two MCP servers)

Configure **two** MCP servers in your client:

- **Custom R&D Tax AI MCP (this repo)**: command `node`, args `["/absolute/path/to/dist/index.js"]`
- **Official Xero MCP**: command `npm`, args `["run","-s","official:xero"]` (or `node scripts/run_official_xero_mcp.mjs`)

Keep them as separate server entries so tool names and env vars remain isolated.

## Future upstream enhancements (not part of the pipeline today)

If we ever want to rely more heavily on the official server, these would likely need to be contributed upstream:

- **Attachments support**: tools to list/fetch attachments (metadata + content), plus required OAuth scopes (e.g. `accounting.attachments`)
- **Per-call tenant selection**: tenant switching/context rather than process-scoped selection
- **Structured export formats**: JSON responses suitable for ingestion pipelines (not only human-oriented text)

