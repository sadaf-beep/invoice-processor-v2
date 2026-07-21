import { InvoiceItem, ColumnConfig } from "../types";

export interface GmailScanMessageResult {
  id: string;
  subject: string;
  from: string;
  status: 'processed' | 'skipped' | 'error';
  itemCount: number;
  items: InvoiceItem[];
  fileName: string;
  error?: string;
}

export interface GmailScanResult {
  messages: GmailScanMessageResult[];
  debug?: { account: string; query: string; matchCount: number; labelError?: string | null };
}

// Calls /api/gmail-scan — server-side only, holds the Gmail OAuth tokens.
export const scanGmailForInvoices = async (
  columns: ColumnConfig[],
  customInstructions: string,
  daysBack: number
): Promise<GmailScanResult> => {
  const response = await fetch("/api/gmail-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns, customInstructions, daysBack }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Gmail scan failed with status ${response.status}`);
  }

  return response.json();
};
