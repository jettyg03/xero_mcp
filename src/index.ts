#!/usr/bin/env node
/**
 * R&D Tax AI — MCP server entrypoint
 * Used by Claude CoWork; stdio transport for IDE/agent connections.
 * Linear: BEN-10 (scaffold), BEN-11 (tool contract).
 */
import { createServer, createStdioTransport } from "./server.js";

const server = createServer();
const transport = createStdioTransport();

server
  .connect(transport)
  .then(() => {
    process.stderr.write("randd-tax-ai-mcp: running on stdio\n");
  })
  .catch((err) => {
    console.error("randd-tax-ai-mcp: failed to start", err);
    process.exit(1);
  });
