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

// Calls /api/extract-license — the licence/support-agreement extraction
// path, distinct from the asset invoice schema above. Returns columns too,
// since the term-dated format's column set is sized dynamically to however
// many coverage terms were actually found in the document.
export const processLicenseWithClaude = async (
  base64Data: string,
  mimeType: string,
  fileName: string,
  format: 'base' | 'term-dated',
  customInstructions: string
): Promise<{ items: InvoiceItem[]; columns: ColumnConfig[] }> => {
  const response = await fetch('/api/extract-license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data, mimeType, fileName, format, customInstructions }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `License extraction failed with status ${response.status}`);
  }

  return response.json();
};
