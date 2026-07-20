
import * as XLSX from 'xlsx';
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

export const generateAllCSV = (sheets: Sheet[], filename: string = 'all_invoices.csv') => {
  if (!sheets || sheets.length === 0) return;

  const colMap = new Map<string, ColumnConfig>();
  sheets.forEach(sheet => {
    sheet.columns?.forEach(col => {
      if (!colMap.has(col.id)) {
        colMap.set(col.id, col);
      }
    });
  });

  const allColumns = Array.from(colMap.values());
  const header = ['Sheet Name', ...allColumns.map(c => c.label || c.id)];

  const allData: Record<string, any>[] = [];
  sheets.forEach(sheet => {
    sheet.data?.forEach(row => {
      const formattedRow: Record<string, any> = { 'Sheet Name': sheet.name };
      allColumns.forEach(col => {
        const val = row[col.id] ?? row[col.label];
        formattedRow[col.label || col.id] = val !== undefined && val !== null ? val : '';
      });
      allData.push(formattedRow);
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(allData, { header: header });
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
