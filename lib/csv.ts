import * as XLSX from 'xlsx';
import { InvoiceItem, ColumnConfig } from '../types.js';

// Server-safe CSV generation — the client-side generateCSV in
// services/excelService.ts does the same sheet_to_csv conversion but then
// triggers a browser Blob download, which doesn't exist in a Vercel function.
export function toCsvString(data: InvoiceItem[], columns: ColumnConfig[]): string {
  const header = columns.map((c) => c.label);
  const worksheet = XLSX.utils.json_to_sheet(data, { header });
  return XLSX.utils.sheet_to_csv(worksheet);
}
