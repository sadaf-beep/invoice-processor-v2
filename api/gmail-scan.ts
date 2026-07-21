import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { ColumnConfig, InvoiceItem } from '../types.js';
import { extractInvoiceItems } from '../lib/extractInvoice.js';
import {
  readGmailEnv, getAccessToken, listMessageIds, getMessage, getHeader,
  findPdfAttachments, getAttachmentBase64, ensureProcessedLabelId, markProcessed,
  getProfile,
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
  items: InvoiceItem[];
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

    const messages: MessageResult[] = [];

    for (const id of messageIds) {
      const message = await getMessage(accessToken, id);
      const subject = getHeader(message, 'Subject') || '(no subject)';
      const from = getHeader(message, 'From') || '';

      if (labelId && message.labelIds?.includes(labelId)) {
        continue;
      }

      const attachments = findPdfAttachments(message);
      if (attachments.length === 0) {
        if (labelId) await markProcessed(accessToken, id, labelId);
        messages.push({ id, subject, from, status: 'skipped', itemCount: 0, items: [] });
        continue;
      }

      try {
        const messageItems: InvoiceItem[] = [];
        for (const attachment of attachments) {
          const base64Data = await getAttachmentBase64(accessToken, id, attachment.attachmentId);
          const extracted = await extractInvoiceItems(client, {
            base64Data,
            mimeType: 'application/pdf',
            columns,
            customInstructions,
            pageRange: 'All',
          });
          messageItems.push(...extracted);
        }
        if (labelId) await markProcessed(accessToken, id, labelId);
        messages.push({ id, subject, from, status: 'processed', itemCount: messageItems.length, items: messageItems });
      } catch (err) {
        // Left unlabeled on failure so the next scan retries it.
        messages.push({ id, subject, from, status: 'error', itemCount: 0, items: [], error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.status(200).json({ messages, debug: { account: profile.emailAddress, query, matchCount: messageIds.length, labelError } });
  } catch (error) {
    console.error('Gmail scan error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
