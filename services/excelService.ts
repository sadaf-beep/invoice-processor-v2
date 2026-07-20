
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { InvoiceItem, ColumnConfig, Sheet } from '../types';

export const generateExcel = (data: InvoiceItem[], columns: ColumnConfig[], filename: string = 'invoice_data.xlsx') => {
  const workbook = XLSX.utils.book_new();

  const header = columns.map(c => c.label);

  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: header
  });

  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Items");
  XLSX.writeFile(workbook, filename);
};

export const generateCSV = (data: InvoiceItem[], columns: ColumnConfig[], filename: string = 'invoice_data.csv') => {
  const header = columns.map(c => c.label);
  const worksheet = XLSX.utils.json_to_sheet(data, { header: header });
  const csv = XLSX.utils.sheet_to_csv(worksheet);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const sanitizeFilename = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'sheet';

// One CSV per sheet, bundled into a single .zip — each invoice keeps its own file rather than
// being merged into one combined sheet.
export const generateAllZip = async (sheets: Sheet[], filename: string = 'all_invoices.zip') => {
  if (!sheets || sheets.length === 0) return;

  const zip = new JSZip();
  const usedNames = new Set<string>();

  sheets.forEach((sheet) => {
    const header = sheet.columns.map((c) => c.label);
    const worksheet = XLSX.utils.json_to_sheet(sheet.data, { header });
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    let name = `${sanitizeFilename(sheet.name)}.csv`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${sanitizeFilename(sheet.name)} (${n}).csv`;
      n++;
    }
    usedNames.add(name);
    zip.file(name, csv);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Parses an uploaded CSV, mapping header text to existing column labels (case-insensitive).
// Columns are a fixed schema, so unrecognized headers are dropped rather than creating new columns.
export const parseCSVFile = (file: File, columns: ColumnConfig[]): Promise<InvoiceItem[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const workbook = XLSX.read(text, { type: 'string' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: false });

        const labelToId = new Map<string, string>();
        columns.forEach((c) => labelToId.set(c.label.trim().toLowerCase(), c.id));

        const items: InvoiceItem[] = rows.map((row) => {
          const item: InvoiceItem = {};
          Object.entries(row).forEach(([key, value]) => {
            const id = labelToId.get(key.trim().toLowerCase());
            if (id) item[id] = value as string | number;
          });
          return item;
        });
        resolve(items);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};
