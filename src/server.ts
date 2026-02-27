/**
 * MCP server factory: creates server with stdio transport and tool registration.
 * All skills conform to: name, description, inputSchema, output with confidence, flagForReview, flagReason?.
 * Linear: BEN-10 (scaffold), BEN-11 (tool contract), BEN-27 (analyse_transcript).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { analyseTranscript } from "./transcript/index.js";

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
          text: JSON.stringify({
            ok: true,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            confidence: 1,
            flagForReview: false,
            flagReason: undefined,
          }),
        },
      ],
    })
  );

  // -------------------------------------------------------------------------
  // analyse_transcript — BEN-24, BEN-25, BEN-26, BEN-27
  // -------------------------------------------------------------------------
  server.registerTool(
    "analyse_transcript",
    {
      description:
        "Extract a structured R&D client profile (ClientRDProfile) from a meeting transcript. " +
        "Supports plain text, Whisper-style JSON, and base64-encoded docx. " +
        "Optionally enriches the profile with industry context and ATO guidance.",
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
        enrich: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to enrich the profile with industry context and ATO guidance (default: true)"
          ),
      },
    },
    async (args): Promise<CallToolResult> => {
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error:
                  "ANTHROPIC_API_KEY environment variable is not set. Cannot run extraction.",
                confidence: 0,
                flagForReview: true,
                flagReason: "Missing API key",
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await analyseTranscript(args.transcript, {
          format: args.format,
          enrich: args.enrich,
          apiKey,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                profile: result.profile,
                confidence: result.confidence,
                flagForReview: result.flagForReview,
                flagReason: result.flagReason,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: message,
                confidence: 0,
                flagForReview: true,
                flagReason: `Extraction failed: ${message}`,
              }),
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
