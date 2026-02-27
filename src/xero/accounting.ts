/**
 * Xero Accounting API client — P&L transaction export.
 * Fetches bank transactions filtered by account type and date range.
 * Linear: BEN-16.
 */

import type { XeroTransaction } from "./types.js";

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

export type AccountType =
  | "EXPENSE"
  | "REVENUE"
  | "ASSET"
  | "LIABILITY"
  | "EQUITY";

export interface GetPLTransactionsOptions {
  /** ISO date, e.g. "2023-07-01" */
  fyStart: string;
  /** ISO date, e.g. "2024-06-30" */
  fyEnd: string;
  accountTypes?: AccountType[];
}

/**
 * Fetch P&L transactions from Xero for the given tenant and date range.
 * Returns results sorted by date ascending.
 */
export async function getPLTransactions(
  tenantId: string,
  accessToken: string,
  options: GetPLTransactionsOptions
): Promise<XeroTransaction[]> {
  const { fyStart, fyEnd, accountTypes = ["EXPENSE", "REVENUE"] } = options;

  // Xero WHERE syntax uses DateTime(year, month, day)
  const toXeroDate = (iso: string) =>
    `DateTime(${iso.split("-").join(",")})`;

  const where = `Date >= ${toXeroDate(fyStart)} AND Date <= ${toXeroDate(fyEnd)}`;

  const url = new URL(`${XERO_API_BASE}/BankTransactions`);
  url.searchParams.set("where", where);
  url.searchParams.set("order", "Date ASC");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Xero Accounting API error: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    BankTransactions?: RawBankTransaction[];
  };

  return (data.BankTransactions ?? [])
    .filter((tx) => {
      const type = tx.LineItems?.[0]?.AccountType;
      // Include if no account type on the line item, or if it matches filter
      return !type || accountTypes.includes(type as AccountType);
    })
    .map(mapTransaction);
}

// ---------------------------------------------------------------------------
// Raw Xero response shapes
// ---------------------------------------------------------------------------

interface RawLineItem {
  Description?: string;
  UnitAmount?: number;
  Quantity?: number;
  AccountCode?: string;
  AccountName?: string;
  AccountType?: string;
}

interface RawBankTransaction {
  BankTransactionID?: string;
  DateString?: string;
  CurrencyCode?: string;
  Contact?: { Name?: string };
  Reference?: string;
  LineItems?: RawLineItem[];
}

function mapTransaction(tx: RawBankTransaction): XeroTransaction {
  const line = tx.LineItems?.[0];
  return {
    id: tx.BankTransactionID ?? "",
    date: tx.DateString ?? "",
    description: line?.Description ?? tx.Reference ?? "",
    amount: (line?.UnitAmount ?? 0) * (line?.Quantity ?? 1),
    currency: tx.CurrencyCode ?? "AUD",
    accountCode: line?.AccountCode ?? "",
    accountName: line?.AccountName ?? "",
    accountType: line?.AccountType ?? "",
    contactName: tx.Contact?.Name,
    reference: tx.Reference,
  };
}
