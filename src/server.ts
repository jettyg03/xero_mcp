/**
 * MCP server factory: creates server with stdio transport and tool registration.
 * All skills conform to the ToolOutput contract (confidence, flagForReview, flagReason?).
 * Linear: BEN-10 (scaffold), BEN-11 (tool contract), BEN-19 (ingest_xero_data).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ingestXeroData,
  ingestXeroDataShape,
} from "./tools/ingest-xero-data.js";

const SERVER_NAME = "randd-tax-ai-mcp";
const SERVER_VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ── Health check ───────────────────────────────────────────────────────────
  server.registerTool(
    "ping",
    {
      description: "Health check / placeholder tool for R&D Tax AI MCP server",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            confidence: 1,
            flagForReview: false,
          }),
        },
      ],
    })
  );

  // ── Xero data ingestion ────────────────────────────────────────────────────
  const clientId = process.env.XERO_CLIENT_ID ?? "";
  const clientSecret = process.env.XERO_CLIENT_SECRET ?? "";

  server.registerTool(
    "ingest_xero_data",
    {
      description:
        "Fetch and normalise P&L transactions from Xero for a given financial year, including receipt attachments.",
      inputSchema: ingestXeroDataShape,
    },
    (input) => ingestXeroData(input, clientId, clientSecret)
  );

  return server;
}

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}
