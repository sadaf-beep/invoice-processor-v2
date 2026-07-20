import { InvoiceItem, ColumnConfig } from "../types";

// Calls our own /api/extract serverless function rather than the Anthropic
// API directly — the API key lives server-side only (see api/extract.ts)
// and is never bundled into client-side JS.
export const processInvoiceWithClaude = async (
  base64Data: string,
  mimeType: string,
  columns: ColumnConfig[],
  customInstructions: string,
  pageRange: string
): Promise<InvoiceItem[]> => {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, mimeType, columns, customInstructions, pageRange }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Extraction failed with status ${response.status}`);
  }

  const { items } = (await response.json()) as { items: InvoiceItem[] };
  return items;
};
