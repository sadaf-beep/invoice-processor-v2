import Anthropic from '@anthropic-ai/sdk';
import { ColumnConfig, InvoiceItem } from '../types.js';
import { extractInvoiceItems } from './extractInvoice.js';
import {
  GmailEnv, getAccessToken, listMessageIds, getMessage, getHeader,
  findPdfAttachments, getAttachmentBase64, ensureProcessedLabelId, markProcessed,
  getProfile,
} from './gmailClient.js';

export interface ScannedAttachment {
  filename: string;
  base64Data: string;
  items: InvoiceItem[];
}

export interface ScannedMessageResult {
  id: string;
  subject: string;
  from: string;
  status: 'processed' | 'skipped' | 'error';
  itemCount: number;
  items: InvoiceItem[];
  // The PDF attachment's own filename — sheets/exports/archives are named
  // after this, not the email subject, so they match the source PDF exactly.
  fileName: string;
  // Raw attachment bytes + per-attachment items — used by the cron job to
  // archive to Drive. Empty for skipped/error messages.
  attachments: ScannedAttachment[];
  error?: string;
}

export interface ScanOptions {
  columns: ColumnConfig[];
  customInstructions: string;
  daysBack: number;
  maxMessages: number;
}

export interface ScanResult {
  messages: ScannedMessageResult[];
  debug: { account: string; query: string; matchCount: number; labelError: string | null };
}

// Core "search → extract → label" loop shared by the manual scan endpoint
// (api/gmail-scan.ts) and the daily cron job (api/cron/daily-scan.ts) — kept
// in one place so both stay in sync rather than drifting apart.
export async function scanInvoiceEmails(client: Anthropic, gmailEnv: GmailEnv, options: ScanOptions): Promise<ScanResult> {
  const { columns, customInstructions, daysBack, maxMessages } = options;

  const accessToken = await getAccessToken(gmailEnv);
  const profile = await getProfile(accessToken);

  // Dedup is a nice-to-have, not core functionality — a label hiccup
  // shouldn't block the actual search + extraction from running at all.
  // A null labelId just means every match this run gets (re-)processed
  // and none get marked, rather than the whole scan failing outright.
  let labelId: string | null = null;
  let labelError: string | null = null;
  try {
    labelId = await ensureProcessedLabelId(accessToken);
  } catch (err) {
    labelError = err instanceof Error ? err.message : String(err);
    console.error('ensureProcessedLabelId failed, continuing without dedup:', labelError);
  }

  // Deliberately no "-label:" clause here — Gmail's search parser handles
  // quoted label-name exclusions inconsistently (confirmed by reproducing
  // it directly in Gmail's own search bar). Already-processed messages are
  // filtered in code instead, from each message's own labelIds.
  const query = `subject:"Invoice Uploaded" has:attachment newer_than:${Math.max(1, daysBack)}d`;
  const messageIds = await listMessageIds(accessToken, query, Math.min(25, Math.max(1, maxMessages)));

  const messages: ScannedMessageResult[] = [];

  for (const id of messageIds) {
    const message = await getMessage(accessToken, id);
    const subject = getHeader(message, 'Subject') || '(no subject)';
    const from = getHeader(message, 'From') || '';

    if (labelId && message.labelIds?.includes(labelId)) {
      continue;
    }

    const pdfAttachments = findPdfAttachments(message);
    if (pdfAttachments.length === 0) {
      if (labelId) await markProcessed(accessToken, id, labelId);
      messages.push({ id, subject, from, status: 'skipped', itemCount: 0, items: [], fileName: subject, attachments: [] });
      continue;
    }

    const fileName = pdfAttachments[0].filename || subject;

    try {
      const messageItems: InvoiceItem[] = [];
      const attachments: ScannedAttachment[] = [];
      for (const attachment of pdfAttachments) {
        const base64Data = await getAttachmentBase64(accessToken, id, attachment.attachmentId);
        const extracted = await extractInvoiceItems(client, {
          base64Data,
          mimeType: 'application/pdf',
          columns,
          customInstructions,
          pageRange: 'All',
        });
        messageItems.push(...extracted);
        attachments.push({ filename: attachment.filename || fileName, base64Data, items: extracted });
      }
      if (labelId) await markProcessed(accessToken, id, labelId);
      messages.push({ id, subject, from, status: 'processed', itemCount: messageItems.length, items: messageItems, fileName, attachments });
    } catch (err) {
      // Left unlabeled on failure so the next scan retries it.
      messages.push({ id, subject, from, status: 'error', itemCount: 0, items: [], fileName, attachments: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { messages, debug: { account: profile.emailAddress, query, matchCount: messageIds.length, labelError } };
}
