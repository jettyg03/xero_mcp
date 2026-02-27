/**
 * Tool contract types for R&D Tax AI MCP server.
 * Every tool registered on this server must return a payload that extends ToolOutput.
 * Linear: BEN-11 (tool contract).
 */

// ---------------------------------------------------------------------------
// Core contract — all tool outputs must include these fields
// ---------------------------------------------------------------------------

export interface ToolOutput {
  /** 0–1: model confidence in the result. Values below 0.7 should typically flagForReview. */
  confidence: number;
  /** True when a human should review this output before it is acted upon. */
  flagForReview: boolean;
  /** Why the output was flagged, if applicable. */
  flagReason?: string;
}

// ---------------------------------------------------------------------------
// Per-tool output types (to be fleshed out when each tool is implemented)
// ---------------------------------------------------------------------------

export interface ClientRDProfile extends ToolOutput {
  clientName: string;
  claimYear: number;
  activities: string[];
}

export interface Transaction extends ToolOutput {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
}

export interface VendorProfile extends ToolOutput {
  vendorName: string;
  isRdEligible: boolean;
  rationale: string;
}

export interface CategorisedTransaction extends ToolOutput {
  transactionId: string;
  category: "rd_eligible" | "rd_ineligible" | "uncertain";
  rationale: string;
}

export interface FinancialSummary extends ToolOutput {
  totalRdExpenditure: number;
  currency: string;
  breakdown: Record<string, number>;
}

export interface SubmissionDocument extends ToolOutput {
  title: string;
  sections: Record<string, string>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helper: serialise a ToolOutput-derived payload for MCP content responses
// ---------------------------------------------------------------------------

export function toToolText<T extends ToolOutput>(payload: T): string {
  return JSON.stringify(payload);
}
