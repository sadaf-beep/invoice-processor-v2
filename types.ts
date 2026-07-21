
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
