# xero-mcp — R&D Tax AI context

This repository hosts the **MCP server** for the R&D Tax AI agent and will implement **Xero Integration & Data Ingestion**. The agent runs in Claude CoWork; the server exposes tools (placeholder now, then `ingest_xero_data`, etc.) for claim preparation.

## Linear

- **MCP Server & Architecture:** BEN-10 → BEN-14 (this repo: server scaffold, tool contract, secrets, E2E).
- **Xero Integration & Data Ingestion:** [BEN-15 → BEN-19](https://linear.app/ben-g/project/randd-tax-ai-xero-integration-and-data-ingestion-05fe257979cb).

## Dependencies

- **Skill definitions:** .md files in the **r-d_ti_ai** repo define skills; this repo implements the server and tools.

## Product docs

- **Context & work units:** [Product/docs/randd-tax-ai/context](../../Product/docs/randd-tax-ai/context) — `02-xero-integration.md`, `work-units/02-xero-integration-work-units.md`.
- **Architecture:** [Product/docs/randd-tax-ai/02-architecture.md](../../Product/docs/randd-tax-ai/02-architecture.md).

## Tool contract

All tools (including **`ingest_xero_data`**, to be added) must conform to the MCP tool output contract: `confidence`, `flagForReview`, `flagReason?`. See [TOOL_CONTRACT.md](./TOOL_CONTRACT.md).
