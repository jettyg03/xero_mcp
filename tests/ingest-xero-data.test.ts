/**
 * Unit tests for ingest_xero_data tool and the normalisation layer.
 * Uses vitest with vi.mock() to stub Xero API calls.
 * Linear: BEN-19.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { XeroTransaction, XeroAttachment } from "../src/xero/types.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock("../src/xero/auth.js", () => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock("../src/xero/accounting.js", () => ({
  getPLTransactions: vi.fn(),
}));

vi.mock("../src/xero/attachments.js", () => ({
  getAttachmentsForTransactions: vi.fn(),
}));

import { getValidAccessToken } from "../src/xero/auth.js";
import { getPLTransactions } from "../src/xero/accounting.js";
import { getAttachmentsForTransactions } from "../src/xero/attachments.js";
import { ingestXeroData } from "../src/tools/ingest-xero-data.js";
import {
  normaliseTransaction,
  normaliseTransactions,
} from "../src/xero/normalise.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-abc-123";
const CLIENT_ID = "clientId";
const CLIENT_SECRET = "clientSecret";
const ACCESS_TOKEN = "mock-access-token";

const cleanTx: XeroTransaction = {
  id: "tx-1",
  date: "2024-01-15",
  description: "AWS Invoice",
  amount: 500,
  currency: "AUD",
  accountCode: "494",
  accountName: "Software",
  accountType: "EXPENSE",
  contactName: "Amazon Web Services",
  reference: "INV-001",
};

const receipt: XeroAttachment = {
  attachmentId: "att-1",
  transactionId: "tx-1",
  fileName: "receipt.pdf",
  contentType: "application/pdf",
  url: "https://xero.com/attachments/att-1",
};

// ---------------------------------------------------------------------------
// ingestXeroData tool — integration tests (mocked Xero API)
// ---------------------------------------------------------------------------

describe("ingestXeroData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getValidAccessToken).mockResolvedValue(ACCESS_TOKEN);
    vi.mocked(getAttachmentsForTransactions).mockResolvedValue(new Map());
  });

  it("returns normalised transactions for a valid financial year", async () => {
    vi.mocked(getPLTransactions).mockResolvedValue([cleanTx]);

    const result = await ingestXeroData(
      { tenantId: TENANT_ID, financialYear: 2024, includeAttachments: false },
      CLIENT_ID,
      CLIENT_SECRET
    );

    const payload = JSON.parse(
      (result.content[0] as { type: string; text: string }).text
    );
    expect(payload.count).toBe(1);
    expect(payload.transactions[0].id).toBe("tx-1");
    expect(payload.transactions[0].description).toBe("AWS Invoice");
    expect(payload.confidence).toBeGreaterThanOrEqual(0.9);
    expect(payload.flagForReview).toBe(false);
  });

  it("fetches attachments when includeAttachments is true", async () => {
    vi.mocked(getPLTransactions).mockResolvedValue([cleanTx]);
    vi.mocked(getAttachmentsForTransactions).mockResolvedValue(
      new Map([["tx-1", [receipt]]])
    );

    const result = await ingestXeroData(
      { tenantId: TENANT_ID, financialYear: 2024, includeAttachments: true },
      CLIENT_ID,
      CLIENT_SECRET
    );

    expect(getAttachmentsForTransactions).toHaveBeenCalledWith(
      TENANT_ID,
      ACCESS_TOKEN,
      ["tx-1"]
    );

    const payload = JSON.parse(
      (result.content[0] as { type: string; text: string }).text
    );
    expect(payload.transactions[0].attachments).toHaveLength(1);
    expect(payload.transactions[0].attachments[0].fileName).toBe("receipt.pdf");
  });

  it("skips attachment fetching when includeAttachments is false", async () => {
    vi.mocked(getPLTransactions).mockResolvedValue([cleanTx]);

    await ingestXeroData(
      { tenantId: TENANT_ID, financialYear: 2024, includeAttachments: false },
      CLIENT_ID,
      CLIENT_SECRET
    );

    expect(getAttachmentsForTransactions).not.toHaveBeenCalled();
  });

  it("handles an empty transaction list", async () => {
    vi.mocked(getPLTransactions).mockResolvedValue([]);

    const result = await ingestXeroData(
      { tenantId: TENANT_ID, financialYear: 2024, includeAttachments: true },
      CLIENT_ID,
      CLIENT_SECRET
    );

    const payload = JSON.parse(
      (result.content[0] as { type: string; text: string }).text
    );
    expect(payload.count).toBe(0);
    expect(payload.confidence).toBe(1);
    expect(payload.flagForReview).toBe(false);
  });

  it("uses AU financial year dates (Jul–Jun)", async () => {
    vi.mocked(getPLTransactions).mockResolvedValue([]);

    await ingestXeroData(
      { tenantId: TENANT_ID, financialYear: 2024, includeAttachments: false },
      CLIENT_ID,
      CLIENT_SECRET
    );

    expect(getPLTransactions).toHaveBeenCalledWith(
      TENANT_ID,
      ACCESS_TOKEN,
      expect.objectContaining({ fyStart: "2023-07-01", fyEnd: "2024-06-30" })
    );
  });
});

// ---------------------------------------------------------------------------
// normaliseTransaction — unit tests (no mocks needed)
// ---------------------------------------------------------------------------

describe("normaliseTransaction", () => {
  it("produces confidence=1 and no flag for a clean transaction", () => {
    const result = normaliseTransaction(cleanTx);
    expect(result.confidence).toBe(1);
    expect(result.flagForReview).toBe(false);
    expect(result.flagReason).toBeUndefined();
  });

  it("flags and reduces confidence for missing transaction ID", () => {
    const result = normaliseTransaction({ ...cleanTx, id: "" });
    expect(result.flagForReview).toBe(true);
    expect(result.confidence).toBeLessThan(1);
    expect(result.flagReason).toContain("missing transaction ID");
  });

  it("flags a zero-amount transaction", () => {
    const result = normaliseTransaction({ ...cleanTx, amount: 0 });
    expect(result.flagForReview).toBe(true);
    expect(result.flagReason).toContain("zero amount");
  });

  it("flags a transaction with no description or reference", () => {
    const result = normaliseTransaction({
      ...cleanTx,
      description: "",
      reference: undefined,
    });
    expect(result.flagForReview).toBe(true);
    expect(result.flagReason).toContain("no description or reference");
  });

  it("preserves originalCurrency and originalAmount for FX transactions", () => {
    const fxTx = { ...cleanTx, currency: "USD", amount: 300 };
    const result = normaliseTransaction(fxTx);
    expect(result.currency).toBe("AUD");
    expect(result.originalCurrency).toBe("USD");
    expect(result.originalAmount).toBe(300);
  });

  it("normalises Xero /Date(ms)/ format to YYYY-MM-DD", () => {
    const ms = new Date("2024-03-15").getTime();
    const result = normaliseTransaction({
      ...cleanTx,
      date: `/Date(${ms}+0000)/`,
    });
    expect(result.date).toBe("2024-03-15");
  });

  it("normalises ISO datetime to date-only string", () => {
    const result = normaliseTransaction({
      ...cleanTx,
      date: "2024-05-20T00:00:00.000Z",
    });
    expect(result.date).toBe("2024-05-20");
  });

  it("amounts are always positive after normalisation", () => {
    const result = normaliseTransaction({ ...cleanTx, amount: -250 });
    expect(result.amount).toBe(250);
  });

  it("attaches provided attachments", () => {
    const result = normaliseTransaction(cleanTx, [receipt]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].fileName).toBe("receipt.pdf");
  });
});

// ---------------------------------------------------------------------------
// normaliseTransactions — batch
// ---------------------------------------------------------------------------

describe("normaliseTransactions", () => {
  it("maps attachments to the correct transaction via ID", () => {
    const tx2: XeroTransaction = { ...cleanTx, id: "tx-2", description: "GCP" };
    const attachmentMap = new Map([["tx-2", [receipt]]]);
    const results = normaliseTransactions([cleanTx, tx2], attachmentMap);

    expect(results[0].attachments).toHaveLength(0); // tx-1 has no attachment
    expect(results[1].attachments).toHaveLength(1); // tx-2 has receipt
  });
});
