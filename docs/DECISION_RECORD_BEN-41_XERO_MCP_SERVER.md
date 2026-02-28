# Decision Record: Official `xero-mcp-server` vs. custom Xero ingestion

Date: 2026-02-28  
Linear: BEN-41  
Status: Accepted

## Context

Xero has released an official open-source MCP server, `XeroAPI/xero-mcp-server`, which exposes ~50 tools (list/create/update/get/delete) over the Xero API using the `xero-node` SDK.

This repo already contains a custom Xero ingestion tool (`ingest_xero_data`) used by the R&D Tax AI pipeline (Stage 2). The Stage 2 output is **transaction-level** data (plus receipt/invoice attachments) normalised to our internal schema and ToolOutput contract (`confidence`, `flagForReview`, `flagReason?`).

## Pipeline requirements (Stage 2)

Stage 2 (`ingest_xero_data`) requires:

- **P&L transaction export**: fetch transaction-level items for a given AU financial year (Jul–Jun), suitable for downstream categorisation.
- **Attachment retrieval**: fetch attached receipts/invoices per transaction (Xero Attachments API).
- **Multi-tenant auth at runtime**: support switching between client organisations at runtime (per client/tenant), not “one org per server process”.
- **Data normalisation**: map raw Xero responses into our internal schema with consistent dates/currency handling and review flags.
- **ToolOutput contract**: return machine-readable JSON including `confidence` and review flags (see `docs/TOOL_CONTRACT.md`).

## What we have today (custom implementation in this repo)

- **Multi-tenant OAuth token store & refresh**: in-memory token store keyed by `tenantId`, refreshes access tokens automatically (`src/xero/auth.ts`).
- **Transaction-level export for FY**: pulls `BankTransactions` with a date-range `where` clause and filters by account types (`src/xero/accounting.ts`).
- **Attachments API retrieval**: pulls `/BankTransactions/{id}/Attachments`, batch-safe with `Promise.allSettled` (`src/xero/attachments.ts`).
- **Normalisation layer**: converts raw transactions into `NormalisedTransaction` with `confidence` and `flagForReview`, handles FX and Xero `/Date(ms)/` format (`src/xero/normalise.ts`).
- **Tool wiring**: `ingest_xero_data` returns JSON payload with `count`, `flaggedCount`, and aggregate confidence (`src/tools/ingest-xero-data.ts`).

## Official server: tool inventory and mapping

The official server’s tools are valuable for interactive accounting workflows, but only a subset overlaps with our Stage 2 ingestion needs.

### List tools (read)

- **Potentially relevant to Stage 2 ingestion**
  - `list-profit-and-loss`: Returns a P&L report (aggregated report rows), **not** transaction exports.
  - `list-bank-transactions`: Lists bank transactions (paged, default page size 10) and exposes `hasAttachments` as a boolean, but does **not** fetch attachment metadata/files.
  - `list-accounts`: Useful for enriching account metadata if needed.
  - `list-organisation-details`: Useful for displaying/confirming connected org.

- **Not directly required for Stage 2**
  - `list-contacts`, `list-contact-groups`
  - `list-invoices`, `list-credit-notes`, `list-quotes`, `list-items`, `list-payments`, `list-tax-rates`
  - `list-trial-balance`, `list-report-balance-sheet`
  - Payroll tools: `list-payroll-employees`, `list-payroll-timesheets`, `list-payroll-*` leave tools
  - Aged reports: `list-aged-receivables-by-contact`, `list-aged-payables-by-contact`
  - Tracking: `list-tracking-categories`
  - `list-manual-journals`

### Create/update/get/delete tools (write)

These are **out of scope** for our ingestion pipeline (Stage 2) and introduce risk/controls requirements we don’t currently want in our R&D Tax AI ingestion server:

- Creates: `create-*` (contacts, invoices, bank transactions, etc.)
- Updates: `update-*` and payroll approvals/reverts
- `get-payroll-timesheet`, `delete-payroll-timesheet`

### Full tool-by-tool mapping (official server)

The table below maps **every** tool in the official server against our Stage 2 needs:

- **P&L transaction export**: do we get transaction-level data for an FY date range suitable for categorisation?
- **Attachment retrieval**: can we fetch attachment metadata/files (not just a boolean)?
- **Multi-tenant runtime**: can we select tenant per call? *(Official server is process/env-scoped → effectively “No” across all tools.)*
- **Normalised output**: does the tool emit our `NormalisedTransaction`-style JSON + ToolOutput fields? *(Official server returns human-readable text → “No” across all tools.)*

| Official tool | Group | P&L transaction export | Attachment retrieval | Multi-tenant runtime | Normalised output | Notes for our pipeline |
|---|---|---|---|---|---|---|
| `list-profit-and-loss` | list | **Partial** (report totals/rows, not transactions) | No | No | No | Useful for high-level totals, not Stage 2 categorisation inputs. |
| `list-bank-transactions` | list | **Partial** (transactions, but interactive paging; not FY export semantics) | No (only `hasAttachments` boolean) | No | No | Closest “transaction-like” tool; still lacks date-range export + attachments. |
| `list-accounts` | list | Indirect | No | No | No | Could enrich account metadata; not sufficient for ingestion alone. |
| `list-organisation-details` | list | N/A | No | No | No | Operational info only. |
| `list-contacts` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-contact-groups` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-invoices` | list | N/A | No | No | No | Not required for Stage 2; could be useful in other workflows. |
| `list-credit-notes` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-quotes` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-items` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-payments` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-tax-rates` | list | N/A | No | No | No | Not required for Stage 2. |
| `list-trial-balance` | list | N/A (aggregated) | No | No | No | Useful for finance reporting, not categorisation inputs. |
| `list-report-balance-sheet` | list | N/A (aggregated) | No | No | No | Useful for finance reporting, not categorisation inputs. |
| `list-aged-receivables-by-contact` | list | N/A (aggregated) | No | No | No | Out of scope for Stage 2. |
| `list-aged-payables-by-contact` | list | N/A (aggregated) | No | No | No | Out of scope for Stage 2. |
| `list-manual-journals` | list | N/A | No | No | No | Out of scope for Stage 2. |
| `list-tracking-categories` | list | N/A | No | No | No | Out of scope for Stage 2. |
| `list-payroll-employees` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-timesheets` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-employee-leave` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-employee-leave-balances` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-employee-leave-types` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-leave-periods` | list | N/A | No | No | No | Payroll (out of scope). |
| `list-payroll-leave-types` | list | N/A | No | No | No | Payroll (out of scope). |
| `create-contact` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-credit-note` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-invoice` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-quote` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-item` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-payment` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-bank-transaction` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-manual-journal` | create | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `create-payroll-timesheet` | create | N/A | No | No | No | Payroll write (out of scope). |
| `create-tracking-category` | create | N/A | No | No | No | Write operation (out of scope). |
| `create-tracking-options` | create | N/A | No | No | No | Write operation (out of scope). |
| `update-contact` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-credit-note` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-invoice` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-quote` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-item` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-bank-transaction` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-manual-journal` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-tracking-category` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `update-tracking-options` | update | N/A | No | No | No | Write operation (out of scope / higher risk). |
| `approve-payroll-timesheet` | update | N/A | No | No | No | Payroll write (out of scope). |
| `revert-payroll-timesheet` | update | N/A | No | No | No | Payroll write (out of scope). |
| `add-payroll-timesheet-line` | update | N/A | No | No | No | Payroll write (out of scope). |
| `update-payroll-timesheet-line` | update | N/A | No | No | No | Payroll write (out of scope). |
| `get-payroll-timesheet` | get | N/A | No | No | No | Payroll (out of scope). |
| `delete-payroll-timesheet` | delete | N/A | No | No | No | Payroll write (out of scope). |

## Gap analysis vs. our requirements

### 1) Attachments API support (critical)

**Gap:** The official server does not expose an attachments retrieval tool (no “get/list attachments” tool; only `hasAttachments` appears on bank transactions). Its Custom Connections OAuth scope list also omits `accounting.attachments`, which is required for our receipts/invoices fetch.

Impact: We cannot replace `src/xero/attachments.ts` with the official toolset without adding new tools and scopes.

### 2) Multi-tenant runtime switching (critical)

**Gap:** The official server authenticates once per process from environment variables and sets a single `tenantId` internally (it selects the first connected tenant). There is no per-call `tenantId` parameter and no tool to list/select tenants/connections.

Impact: For our pipeline (multiple client orgs), we would need either:

- one server process per client org, or
- an extension to the official server to accept per-call tenant selection and token context.

### 3) Transaction export suitable for categorisation (critical)

**Gap:** Our pipeline needs **transaction-level** exports for an AU financial year and downstream categorisation. The official `list-profit-and-loss` returns an aggregated report, and `list-bank-transactions` is paged and geared toward interactive browsing (page size 10, optional bankAccount filter), not deterministic FY exports with account-type filtering.

Impact: We would still need a purpose-built ingestion/export tool.

### 4) Data normalisation + ToolOutput contract (critical)

**Gap:** Official tools return human-oriented text blocks and do not emit our ToolOutput contract fields (`confidence`, `flagForReview`). They also do not normalise into our `NormalisedTransaction` schema.

Impact: Even if the API coverage matched, we’d need a wrapper/adapter layer for every relevant tool to keep our orchestration stable.

## Maintenance assessment

- **Official server strengths**
  - Maintained by Xero; will likely track API/SDK changes quickly.
  - Broad coverage of accounting/payroll objects beyond our immediate needs.

- **Costs to adopt it for Stage 2**
  - Requires substantive work to add/extend: attachments retrieval, per-tenant runtime selection, FY transaction export semantics, and our ToolOutput/normalisation contract.
  - Introduces non-trivial migration churn: tool naming differs (`list-bank-transactions` vs `ingest_xero_data`), outputs differ (text vs JSON), and our orchestration docs/tests would need updating.

- **Custom build strengths**
  - Purpose-built for our pipeline requirements, already implemented and tested.
  - Small surface area (auth + transactions + attachments + normalise) lowers operational risk.

## Decision

**Decision:** **Retain the custom Xero ingestion implementation** for Stage 2 (`ingest_xero_data`). Optionally use the official server **alongside** our server for ad-hoc exploration/debugging (accounts, P&L reports, invoices), but do **not** migrate Stage 2 ingestion to the official toolset at this time.

Rationale:

- The official server **does not currently meet** Stage 2’s critical requirements (attachments retrieval, runtime multi-tenant switching, deterministic FY export semantics, and ToolOutput + normalisation).
- Using it “as-is” would add a second integration layer (adapters/wrappers) while still requiring custom code for the hardest parts.

## Follow-up tickets (recommended)

- **Gap-fill if we want to leverage official server later**
  - Add attachment retrieval tools (transaction/invoice attachment metadata + content fetch) and required scopes.
  - Add tenant selection/listing (connections) with per-call tenant context.
  - Add an export-oriented tool (FY date-range, account-type filtering, pagination) that outputs JSON suitable for our pipeline.
  - Add ToolOutput contract support (confidence/review flags) or provide a stable adapter layer.

- **Hardening our custom ingestion**
  - Replace in-memory token store with persistent encrypted storage (KMS/DB).
  - Add pagination/backoff for large FY exports; consider rate-limit handling.

