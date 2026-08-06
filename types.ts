
export interface InvoiceItem {
  [key: string]: string | number | undefined;
}

export type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

export interface ColumnConfig {
  id: string;
  label: string;
  type: 'string' | 'number' | 'date';
  required: boolean;
  width?: number;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  fontFamily?: string;
}

export interface Sheet {
  id: string;
  name: string;
  data: InvoiceItem[];
  columns: ColumnConfig[];
  customInstructions: string;
  styles: Record<string, CellStyle>; // Key: "rowIndex-colId"
  kind?: 'asset' | 'license'; // absent/undefined is treated as 'asset' for backward compatibility
}

// A named, reusable client-specific processing setup — saved so it can be
// picked from a dropdown instead of rebuilding columns/instructions by hand
// every time. Stored in localStorage (see services/profileStore.ts), not on
// the server — this is a per-browser convenience, not a synced/shared list.
export interface FormatProfile {
  id: string;
  name: string;
  family: 'asset' | 'license';
  // Asset profiles can swap the whole column schema (e.g. TVA's Spanish
  // fields); licence profiles reuse the standard Beam column layout and
  // only vary instructions + layout, so columns is asset-only.
  columns?: ColumnConfig[];
  instructions: string;
  licenseLayout?: 'base' | 'term-dated';
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "Status", label: "Status", type: 'string', required: true },
  { id: "Manufacturer", label: "Manufacturer", type: 'string', required: true },
  { id: "Model #", label: "Model #", type: 'string', required: true },
  { id: "Product Name", label: "Product Name", type: 'string', required: true },
  { id: "Serial #", label: "Serial #", type: 'string', required: false },
  { id: "Purchase Date", label: "Purchase Date", type: 'date', required: true },
  { id: "Purchase Price", label: "Purchase Price", type: 'number', required: true },
  { id: "Vendor", label: "Vendor", type: 'string', required: true },
  { id: "PO #", label: "PO #", type: 'string', required: false },
  { id: "Item Type", label: "Item Type", type: 'string', required: true },
];

export const DEFAULT_INSTRUCTIONS = ``;

// Built-in format for TVA's Spanish-language "Pedido" POs — from the
// tva-po-processing skill. Column order matches that skill's CSV header
// exactly (English base-format fields + Spanish new fields).
export const TVA_PO_COLUMNS: ColumnConfig[] = [
  { id: 'Orden de Compra', label: 'Orden de Compra', type: 'string', required: true },
  { id: 'Companies', label: 'Companies', type: 'string', required: true },
  { id: 'Nº solicitud de compra', label: 'Nº solicitud de compra', type: 'string', required: false },
  { id: 'Product Name', label: 'Product Name', type: 'string', required: true },
  { id: 'Manufacturer', label: 'Manufacturer', type: 'string', required: false },
  { id: 'Model #', label: 'Model #', type: 'string', required: false },
  { id: 'Quantity', label: 'Quantity', type: 'number', required: false },
  { id: 'Purchase Date', label: 'Purchase Date', type: 'date', required: false },
  { id: 'Purchase Price', label: 'Purchase Price', type: 'number', required: false },
  { id: 'Impuestos', label: 'Impuestos', type: 'number', required: false },
  { id: 'Importe', label: 'Importe', type: 'number', required: false },
  { id: 'Item Type', label: 'Item Type', type: 'string', required: true },
  { id: 'Serial #', label: 'Serial #', type: 'string', required: false },
];

export const TVA_PO_INSTRUCTIONS = `These are TVA Purchase Orders (Pedidos) — Spanish-language PDFs identified by field labels like "Nº DE PEDIDO", "PROVEEDOR", "Nº solicitud de compra", and "DETALLES DE ARTÍCULO EN LÍNEA". Match on these Spanish field labels and the single-vs-multi-article structure, NOT on letterhead or vendor branding ("Grupo Salinas" is incidental, not defining — vendor names vary PO to PO). Treat structural descriptions as patterns, not guarantees; when a PO doesn't match the expected layout, read it on its own terms, map what's printed to the closest column, leave genuinely missing fields blank, and flag anything ambiguous rather than force-fitting.

OUTPUT ONE JSON OBJECT PER LINE ITEM. A single PO routinely bundles many line items (equipment, spare parts, service/licence payments) under one PO number — each gets its own object with the same PO number repeated. Never split one PO across multiple PO numbers and never merge two POs into one row. The Quantity field already carries the quantity printed on the PO — do NOT create multiple JSON objects for one line just because Quantity > 1.

Field-by-field:
- Orden de Compra: the bold "Nº DE PEDIDO" heading at the top of the doc (e.g. 4501544625). Distinct from Nº solicitud de compra — never conflate them.
- Companies: the "PROVEEDOR:" block (vendor name). Vendor names vary per PO.
- Nº solicitud de compra: the purchase request number, e.g. "Nº solicitud de compra: PR2152516" — a DIFFERENT number from Orden de Compra.
- Product Name: the full/complete description line ("Descripción completa") under each item table, NOT the truncated table cell.
- Manufacturer: infer from the description. Leave blank if not confidently inferable — do not guess.
- Model #: the "NÚMERO DE PIEZA" (part number) from the item table, as printed (e.g. ARTIST-1024, RSP-1232HL).
- Quantity: the "CTD." (Cantidad) value from the item table, as printed. Record once per line — never split into multiple rows.
- Purchase Date: from the line-item "FECHA PARA LA QUE SE REQUIERE", NOT the header's "Emitido el..." issue date. TVA dates are day-first (dd/mm/yyyy, Mexican convention) — CONVERT to MM/DD/YYYY, don't just reformat the slashes. When spelled out (e.g. "lunes, 30 junio, 2025"), parse day/month names directly (→ 06/30/2025). When numeric (e.g. 11/06/2025 = 11 June), convert to 06/11/2025. Double-check any date where the day ≤ 12, since those look valid in either format — always resolve against the source, never guess.
- Purchase Price: the "PRECIO POR UNIDAD" (unit price, before discount) from the item table. Plain number only — no currency symbol or suffix.
- Impuestos: the tax amount from the IMPUESTOS column / IVA breakdown table below the item (commonly 16.0% IVA Acreditable, but confirm the rate/label printed rather than assuming). Plain number only — no currency symbol or suffix.
- Importe: the line total (net + tax) from the rightmost IMPORTE column. Plain number only — no currency symbol or suffix.
- Item Type: classify using the standard 6-tier waterfall (LABOUR → SHIPPING → PREPAID → BULK ITEM → ASSET → UNKNOWN/REVIEW_REQUIRED). TVA procures far more than broadcast gear — IT hardware, furniture, office supplies, construction materials, services, software — apply the waterfall to whatever shows up.
- Serial #: ALWAYS leave blank at entry. Filled only on physical receipt, ASSET rows only.

Do NOT add a Status column — deliberately removed from this format; receipt tracking relies on Serial # being filled for ASSET rows. Do NOT capture the header issue date ("Emitido el..."), Importe Total, Moneda/currency, Facturar A / Entregar A, Cuenta CG (GL account), Centro de Costos, Título, Solicitante, Términos de Pago, Línea #, Descuento, Importe Neto, Días de Garantía, or Original Req ID as their own fields — these are context only, not columns in this format.

Currency: TVA POs are issued in MXN or USD (see the suffix on Importe Total); other currencies may appear. Purchase Price/Impuestos/Importe must always be plain numeric values regardless of which currency the PO is in — never embed the currency symbol or code in the number itself.

Validation: no line item should be missing Orden de Compra, Product Name, Importe, or Item Type.`;

// Column layout for the licence-processing "base" format — see the
// licence-processing skill for the full rules behind each field. Order
// matters: buildTermDatedColumns() below splices term columns in at the
// exact position "Initial Term Start/End/Amount" occupies here.
export const LICENSE_BASE_COLUMNS: ColumnConfig[] = [
  { id: 'Contract Name', label: 'Contract Name', type: 'string', required: true },
  { id: 'Manufacturer', label: 'Manufacturer', type: 'string', required: true },
  { id: 'Model #', label: 'Model #', type: 'string', required: false },
  { id: 'Description', label: 'Description', type: 'string', required: false },
  { id: 'Client', label: 'Client', type: 'string', required: false },
  { id: 'Initial Term Start', label: 'Initial Term Start', type: 'date', required: false },
  { id: 'Initial Term End', label: 'Initial Term End', type: 'date', required: false },
  { id: 'Amount', label: 'Amount', type: 'number', required: false },
  { id: 'QTY', label: 'QTY', type: 'number', required: false },
  { id: 'Purchase Date', label: 'Purchase Date', type: 'date', required: false },
  { id: 'Type', label: 'Type', type: 'string', required: true },
  { id: 'Quote Number', label: 'Quote Number', type: 'string', required: false },
  { id: 'Asset Relationships', label: 'Asset Relationships', type: 'string', required: false },
  { id: 'Status', label: 'Status', type: 'string', required: true },
  { id: 'Category', label: 'Category', type: 'string', required: false },
  { id: 'PO Number', label: 'PO Number', type: 'string', required: false },
  { id: 'Invoice Number', label: 'Invoice Number', type: 'string', required: false },
  { id: 'Review Notes', label: 'Review Notes', type: 'string', required: false },
];

// Term-dated variant: "Initial Term Start/End/Amount" is replaced by a
// "Term 1 ..." group in the same position, and Term 2+ groups are appended
// after Review Notes — one group per additional coverage period found.
export function buildTermDatedColumns(termCount: number): ColumnConfig[] {
  const n = Math.max(1, termCount);
  const startIdx = LICENSE_BASE_COLUMNS.findIndex((c) => c.id === 'Initial Term Start');
  const endIdx = LICENSE_BASE_COLUMNS.findIndex((c) => c.id === 'Amount');
  const before = LICENSE_BASE_COLUMNS.slice(0, startIdx);
  const after = LICENSE_BASE_COLUMNS.slice(endIdx + 1); // QTY ... Review Notes

  const termGroup = (i: number): ColumnConfig[] => [
    { id: `Term ${i} Start`, label: `Term ${i} Start`, type: 'date', required: false },
    { id: `Term ${i} End`, label: `Term ${i} End`, type: 'date', required: false },
    { id: `Term ${i} Amount`, label: `Term ${i} Amount`, type: 'number', required: false },
  ];

  const laterTerms: ColumnConfig[] = [];
  for (let i = 2; i <= n; i++) laterTerms.push(...termGroup(i));

  return [...before, ...termGroup(1), ...after, ...laterTerms];
}
