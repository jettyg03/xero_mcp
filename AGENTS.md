# AGENTS.md

## Cursor Cloud specific instructions

This is a TypeScript MCP (Model Context Protocol) server for R&D Tax AI claim preparation. It communicates over **stdio** (not HTTP), so there is no web UI or HTTP endpoint to test against.

### Key commands

All standard commands are in `package.json` scripts:
- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run Vitest test suite (`vitest run`)
- `npm run dev` — build + start server (stdio)
- `npm start` — run built server (stdio)

### Testing the server

The server uses stdio JSON-RPC (MCP protocol). To invoke a tool interactively:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}\n' | node dist/index.js 2>/dev/null
```

### Known issues

- One pre-existing test failure in `tests/ingest-xero-data.test.ts`: the test "skips attachment fetching when includeAttachments is false" fails because the implementation still calls `getAttachmentsForTransactions` regardless. This is not an environment issue.

### Notes

- No database, Docker, or external services are needed. All external API calls (Xero) are mocked in tests.
- `npm install` triggers the `prepare` script which runs `tsc` (build). The build must succeed for install to complete.
- Xero credentials (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`) are only needed for live Xero integration, not for tests.
