import { sql } from '@vercel/postgres';

export interface ProcessedInvoiceRecord {
  runDate: string; // YYYY-MM-DD
  messageId: string;
  subject: string;
  fromAddress: string;
  fileName: string;
  itemCount: number;
  status: 'processed' | 'skipped' | 'error';
  drivePdfLink?: string | null;
  driveCsvLink?: string | null;
  error?: string | null;
}

export interface ProcessedInvoiceRow extends ProcessedInvoiceRecord {
  id: number;
  createdAt: string;
}

// Called before every read/write — CREATE TABLE IF NOT EXISTS is idempotent
// and cheap, so this self-heals on first use rather than requiring a
// separate manual migration step.
export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS processed_invoices (
      id SERIAL PRIMARY KEY,
      run_date DATE NOT NULL,
      message_id TEXT NOT NULL,
      subject TEXT,
      from_address TEXT,
      file_name TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      drive_pdf_link TEXT,
      drive_csv_link TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function insertProcessedInvoice(record: ProcessedInvoiceRecord): Promise<void> {
  await sql`
    INSERT INTO processed_invoices
      (run_date, message_id, subject, from_address, file_name, item_count, status, drive_pdf_link, drive_csv_link, error)
    VALUES
      (${record.runDate}, ${record.messageId}, ${record.subject}, ${record.fromAddress}, ${record.fileName},
       ${record.itemCount}, ${record.status}, ${record.drivePdfLink ?? null}, ${record.driveCsvLink ?? null}, ${record.error ?? null})
  `;
}

export async function listProcessedInvoices(limit = 200): Promise<ProcessedInvoiceRow[]> {
  const { rows } = await sql`
    SELECT id, run_date, message_id, subject, from_address, file_name, item_count, status,
           drive_pdf_link, drive_csv_link, error, created_at
    FROM processed_invoices
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    runDate: r.run_date,
    messageId: r.message_id,
    subject: r.subject,
    fromAddress: r.from_address,
    fileName: r.file_name,
    itemCount: r.item_count,
    status: r.status,
    drivePdfLink: r.drive_pdf_link,
    driveCsvLink: r.drive_csv_link,
    error: r.error,
    createdAt: r.created_at,
  }));
}
