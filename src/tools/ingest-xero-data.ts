/**
 * ingest_xero_data MCP tool handler.
 *
 * Input:  tenantId, financialYear, includeAttachments
 * Output: normalised transactions with attachments, ToolOutput contract fields.
 *
 * Linear: BEN-19.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getValidAccessToken } from "../xero/auth.js";
import { getPLTransactions } from "../xero/accounting.js";
import { getAttachmentsForTransactions } from "../xero/attachments.js";
import { normaliseTransactions } from "../xero/normalise.js";

// ---------------------------------------------------------------------------
// Input schema (shared between server registration and tests)
// ---------------------------------------------------------------------------

export const ingestXeroDataShape = {
  tenantId: z
    .string()
    .min(1)
    .describe("Xero tenant/organisation ID (required per call)"),
  financialYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .describe(
      "Financial year end (e.g. 2024 = FY2024, 1 Jul 2023 – 30 Jun 2024 for AU)"
    ),
  includeAttachments: z
    .boolean()
    .default(true)
    .describe("Fetch receipt/invoice attachments for each transaction"),
};

export type IngestXeroDataInput = {
  tenantId: string;
  financialYear: number;
  includeAttachments: boolean;
};

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function ingestXeroData(
  input: IngestXeroDataInput,
  clientId: string,
  clientSecret: string
): Promise<CallToolResult> {
  const { tenantId, financialYear, includeAttachments } = input;

  // Australian financial year: 1 Jul (year−1) to 30 Jun (year)
  const fyStart = `${financialYear - 1}-07-01`;
  const fyEnd = `${financialYear}-06-30`;

  const accessToken = await getValidAccessToken(tenantId, clientId, clientSecret);

  const rawTransactions = await getPLTransactions(tenantId, accessToken, {
    fyStart,
    fyEnd,
  });

  const attachmentsByTxId = includeAttachments
    ? await getAttachmentsForTransactions(
        tenantId,
        accessToken,
        rawTransactions.map((tx) => tx.id)
      )
    : new Map();

  const normalised = normaliseTransactions(rawTransactions, attachmentsByTxId);

  const flagged = normalised.filter((tx) => tx.flagForReview);
  const avgConfidence =
    normalised.length > 0
      ? normalised.reduce((sum, tx) => sum + tx.confidence, 0) / normalised.length
      : 1;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          transactions: normalised,
          count: normalised.length,
          flaggedCount: flagged.length,
          confidence: avgConfidence,
          flagForReview: flagged.length > 0,
          flagReason:
            flagged.length > 0
              ? `${flagged.length} transaction(s) require review`
              : undefined,
        }),
      },
    ],
  };
}
