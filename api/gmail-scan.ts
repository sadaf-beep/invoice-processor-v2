import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { ColumnConfig } from '../types.js';
import { readGmailEnv } from '../lib/gmailClient.js';
import { scanInvoiceEmails } from '../lib/invoiceScan.js';

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
    const { messages, debug } = await scanInvoiceEmails(client, gmailEnv, { columns, customInstructions, daysBack, maxMessages });
    // The browser only needs extracted items, not the raw attachment bytes
    // (those are only used server-side by the cron job for Drive archival).
    const trimmed = messages.map(({ attachments, ...rest }) => rest);
    res.status(200).json({ messages: trimmed, debug });
  } catch (error) {
    console.error('Gmail scan error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
