# xero-mcp

**MCP server** for the R&D Tax AI agent (Claude CoWork). This repo contains the server implementation (BEN-10+) and will add **Xero integration & data ingestion** tools (BEN-15 → BEN-19), e.g. `ingest_xero_data`.

## Run the MCP server

```bash
npm install
npm run build
npm start   # stdio transport for Claude CoWork / Cursor
```

## Docs

- **[docs/CONTEXT.md](./docs/CONTEXT.md)** — Product context, Linear links.
- **[docs/TOOL_CONTRACT.md](./docs/TOOL_CONTRACT.md)** — Tool registration pattern (BEN-11).
- **[docs/XERO_MULTI_TENANT_ONBOARDING.md](./docs/XERO_MULTI_TENANT_ONBOARDING.md)** — Multi-tenant Xero OAuth onboarding + token storage (BEN-44).

Skill-definition .md files live in the **r-d_ti_ai** repo.
