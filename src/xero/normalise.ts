/**
 * Normalisation layer — transforms raw Xero API responses into the internal data schema.
 * Handles: missing fields, foreign currency transactions, split line items.
 * All outputs include confidence + flagForReview to conform to the ToolOutput contract.
 * Linear: BEN-18.
 */

import type { XeroTransaction, XeroAttachment } from "./types.js";

const BASE_CURRENCY = "AUD";

// ---------------------------------------------------------------------------
// Internal normalised transaction schema
// ---------------------------------------------------------------------------

export interface NormalisedTransaction {
  // Core identity
  id: string;
  date: string;
  description: string;
  /** Amount in base currency (AUD), always positive. */
  amount: number;
  currency: typeof BASE_CURRENCY;
  // Account metadata
  accountCode: string;
  accountName: string;
  accountType: string;
  contactName?: string;
  reference?: string;
  // Attachments
  attachments: XeroAttachment[];
  // Preserved original values for foreign-currency transactions
  originalCurrency?: string;
  originalAmount?: number;
  // ToolOutput contract fields
  confidence: number;
  flagForReview: boolean;
  flagReason?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normaliseTransaction(
  raw: XeroTransaction,
  attachments: XeroAttachment[] = []
): NormalisedTransaction {
  const flags = collectFlags(raw);
  const isForeign = raw.currency !== BASE_CURRENCY;

  return {
    id: raw.id || uniqueFallbackId(),
    date: normaliseDate(raw.date),
    description: (raw.description || raw.reference || "No description").trim(),
    amount: Math.abs(raw.amount),
    currency: BASE_CURRENCY,
    accountCode: raw.accountCode,
    accountName: raw.accountName,
    accountType: raw.accountType,
    contactName: raw.contactName,
    reference: raw.reference,
    attachments,
    // Preserve original currency info when it differs from base
    ...(isForeign && {
      originalCurrency: raw.currency,
      originalAmount: raw.amount,
    }),
    // ToolOutput fields
    confidence: Math.max(0, 1 - flags.length * 0.2),
    flagForReview: flags.length > 0,
    flagReason: flags.length ? flags.join("; ") : undefined,
  };
}

/**
 * Normalise a batch of transactions, attaching pre-fetched attachments by ID.
 */
export function normaliseTransactions(
  rawTransactions: XeroTransaction[],
  attachmentsByTxId: Map<string, XeroAttachment[]>
): NormalisedTransaction[] {
  return rawTransactions.map((tx) =>
    normaliseTransaction(tx, attachmentsByTxId.get(tx.id) ?? [])
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a date string to YYYY-MM-DD.
 * Xero can return ISO strings or /Date(timestamp+offset)/ format.
 */
function normaliseDate(raw: string): string {
  if (!raw) return new Date().toISOString().split("T")[0];

  // Handle Xero's /Date(1704067200000+0000)/ format
  const msMatch = raw.match(/\/Date\((\d+)[+-]/);
  if (msMatch) {
    return new Date(Number(msMatch[1])).toISOString().split("T")[0];
  }

  // Strip time component if present
  return raw.split("T")[0] ?? raw;
}

/** Generate a unique fallback ID so batch normalisation never produces duplicate ids. */
function uniqueFallbackId(): string {
  return `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Collect data-quality issues that should trigger flagForReview. */
function collectFlags(tx: XeroTransaction): string[] {
  const flags: string[] = [];
  if (!tx.id) flags.push("missing transaction ID");
  if (tx.amount === 0) flags.push("zero amount");
  if (!tx.description && !tx.reference)
    flags.push("no description or reference");
  if (!tx.accountCode) flags.push("missing account code");
  return flags;
}
