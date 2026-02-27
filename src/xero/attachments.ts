/**
 * Xero Attachments API — fetch receipts and invoices per transaction.
 * Returns structured file references with metadata; handles missing attachments gracefully.
 * Linear: BEN-17.
 */

import type { XeroAttachment } from "./types.js";

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/** Xero transaction IDs are UUID-like; allow only safe chars to prevent path traversal. */
const SAFE_TRANSACTION_ID = /^[a-zA-Z0-9-]{1,64}$/;
function assertSafeTransactionId(transactionId: string): void {
  if (!SAFE_TRANSACTION_ID.test(transactionId)) {
    throw new Error(
      `Invalid transactionId: must be alphanumeric or hyphen, 1–64 chars. Got length ${transactionId.length}.`
    );
  }
}

/**
 * Fetch all attachments for a single bank transaction.
 * Returns an empty array (not an error) when no attachments exist.
 */
export async function getAttachmentsForTransaction(
  tenantId: string,
  accessToken: string,
  transactionId: string
): Promise<XeroAttachment[]> {
  assertSafeTransactionId(transactionId);
  const url = `${XERO_API_BASE}/BankTransactions/${transactionId}/Attachments`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });

  // 404 means no attachments for this transaction — treat as empty, not an error
  if (res.status === 404) return [];

  if (!res.ok) {
    throw new Error(
      `Xero Attachments API error for transaction ${transactionId}: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { Attachments?: RawAttachment[] };
  return (data.Attachments ?? []).map((a) => mapAttachment(a, transactionId));
}

/**
 * Fetch attachments for a batch of transactions concurrently.
 * Uses Promise.allSettled so one failure does not fail the whole batch.
 * Returns a Map from transactionId → XeroAttachment[] (failed IDs get []).
 */
export async function getAttachmentsForTransactions(
  tenantId: string,
  accessToken: string,
  transactionIds: string[]
): Promise<Map<string, XeroAttachment[]>> {
  const results = await Promise.allSettled(
    transactionIds.map(async (id) => {
      const attachments = await getAttachmentsForTransaction(
        tenantId,
        accessToken,
        id
      );
      return [id, attachments] as const;
    })
  );
  const map = new Map<string, XeroAttachment[]>();
  results.forEach((r, i) => {
    const id = transactionIds[i];
    if (r.status === "fulfilled") {
      map.set(id, r.value[1]);
    } else {
      map.set(id, []);
    }
  });
  return map;
}

// ---------------------------------------------------------------------------
// Raw Xero response shape
// ---------------------------------------------------------------------------

interface RawAttachment {
  AttachmentID?: string;
  FileName?: string;
  MimeType?: string;
  Url?: string;
  ContentLength?: number;
}

function mapAttachment(
  a: RawAttachment,
  transactionId: string
): XeroAttachment {
  return {
    attachmentId: a.AttachmentID ?? "",
    transactionId,
    fileName: a.FileName ?? "",
    contentType: a.MimeType ?? "application/octet-stream",
    url: a.Url ?? "",
    size: a.ContentLength,
  };
}
