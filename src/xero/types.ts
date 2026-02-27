/**
 * Shared Xero API type definitions used across auth, accounting, attachments, and normalisation.
 * Linear: BEN-15, BEN-16, BEN-17, BEN-18.
 */

export interface XeroTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) at which the access token expires. */
  expiresAt: number;
  tenantId: string;
}

export interface XeroTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  contactName?: string;
  reference?: string;
}

export interface XeroAttachment {
  attachmentId: string;
  transactionId: string;
  fileName: string;
  contentType: string;
  /** Xero-hosted URL for the file. */
  url: string;
  size?: number;
}
