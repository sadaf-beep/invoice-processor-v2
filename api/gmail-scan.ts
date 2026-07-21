import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { ColumnConfig, InvoiceItem } from '../types.js';
import { extractInvoiceItems } from '../lib/extractInvoice.js';
import {
  readGmailEnv, getAccessToken, listMessageIds, getMessage, getHeader,
  findPdfAttachments, getAttachmentBase64, ensureProcessedLabelId, markProcessed,
  getProfile, PROCESSED_LABEL_NAME,
} from '../lib/gmailClient.js';

// Manual scan can involve several sequential Claude calls (one per PDF) —
// give it the same headroom as a single extraction, times a few messages.
export const config = {
  maxDuration: 60,
};

interface ScanRequestBody {
  columns: ColumnConfig[];
  customInstructions: string;
  daysBack?: number;
  maxMessages?: number;
}

interface MessageResult {
  id: string;
  subject: string;
  from: string;
  status: 'processed' | 'skipped' | 'error';
  itemCount: number;
  error?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const gmailEnv = readGmailEnv();
  if (!gmailEnv) {
    res.status(500).json({
      error: 'Gmail is not connected yet. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN, then visit /api/gmail/auth once.',
    });
    return;
  }

  const { columns, customInstructions, daysBack = 7, maxMessages = 5 } = req.body as ScanRequestBody;
  if (!Array.isArray(columns)) {
    res.status(400).json({ error: 'Missing required field: columns.' });
    return;
  }

  const client = new Anthropic({ apiKey: anthropicKey });

  try {
    const accessToken = await getAccessToken(gmailEnv);
    const profile = await getProfile(accessToken);
    const labelId = await ensureProcessedLabelId(accessToken);

    const query = `subject:"Invoice Uploaded" has:attachment -label:"${PROCESSED_LABEL_NAME}" newer_than:${Math.max(1, daysBack)}d`;
    const messageIds = await listMessageIds(accessToken, query, Math.min(25, Math.max(1, maxMessages)));

    const items: InvoiceItem[] = [];
    const messages: MessageResult[] = [];

    for (const id of messageIds) {
      const message = await getMessage(accessToken, id);
      const subject = getHeader(message, 'Subject') || '(no subject)';
      const from = getHeader(message, 'From') || '';

      const attachments = findPdfAttachments(message);
      if (attachments.length === 0) {
        await markProcessed(accessToken, id, labelId);
        messages.push({ id, subject, from, status: 'skipped', itemCount: 0 });
        continue;
      }

      try {
        let messageItemCount = 0;
        for (const attachment of attachments) {
          const base64Data = await getAttachmentBase64(accessToken, id, attachment.attachmentId);
          const extracted = await extractInvoiceItems(client, {
            base64Data,
            mimeType: 'application/pdf',
            columns,
            customInstructions,
            pageRange: 'All',
          });
          items.push(...extracted);
          messageItemCount += extracted.length;
        }
        await markProcessed(accessToken, id, labelId);
        messages.push({ id, subject, from, status: 'processed', itemCount: messageItemCount });
      } catch (err) {
        // Left unlabeled on failure so the next scan retries it.
        messages.push({ id, subject, from, status: 'error', itemCount: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.status(200).json({ items, messages, debug: { account: profile.emailAddress, query, matchCount: messageIds.length } });
  } catch (error) {
    console.error('Gmail scan error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
