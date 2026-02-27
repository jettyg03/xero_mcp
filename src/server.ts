/**
 * MCP server factory: creates server with stdio transport and tool registration.
 * All skills conform to the ToolOutput contract (see src/types.ts).
 * Linear: BEN-10 (scaffold), BEN-11 (tool contract), BEN-40 (analyse_transcript slim).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ingestXeroData,
  ingestXeroDataShape,
} from "./tools/ingest-xero-data.js";
import { toToolText } from "./types.js";
import { normaliseForAnalysis } from "./transcript/index.js";

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

  // -------------------------------------------------------------------------
  // ping — health check
  // -------------------------------------------------------------------------
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
          text: toToolText({
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

  // -------------------------------------------------------------------------
  // analyse_transcript — BEN-40 (normalisation only; extraction done by CoWork)
  // -------------------------------------------------------------------------
  server.registerTool(
    "analyse_transcript",
    {
      description:
        "Normalise a meeting transcript to plain text. Supports plain text, Whisper-style JSON, " +
        "and base64-encoded docx. Returns the extracted plain text for the calling agent to analyse. " +
        "Does not perform extraction or enrichment — those are handled by the CoWork skill document.",
      inputSchema: {
        transcript: z
          .string()
          .min(1)
          .describe(
            "The transcript content. For txt/whisper_json: the raw string. " +
              "For docx_base64: the base64-encoded document bytes."
          ),
        format: z
          .enum(["txt", "whisper_json", "docx_base64"])
          .optional()
          .default("txt")
          .describe("Input format (default: txt)"),
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const { text } = await normaliseForAnalysis(args.transcript, {
          format: args.format,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ text }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}
