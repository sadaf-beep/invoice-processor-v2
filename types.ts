
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
