import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { ColumnConfig } from '../types';
import { extractInvoiceItems } from '../lib/extractInvoice';

// Vercel functions default to a 10s timeout on most plans; Claude with
// adaptive thinking on a multi-page invoice can easily take longer than
// that. Raise it explicitly. (Hobby plan caps this at 60s; Pro/Enterprise
// allow more — see https://vercel.com/docs/functions/configuring-functions/duration)
export const config = {
  maxDuration: 60,
};

interface ExtractRequestBody {
  base64Data: string;
  mimeType: string;
  columns: ColumnConfig[];
  customInstructions: string;
  pageRange: string;
}

// This runs server-side only (Vercel Node function). ANTHROPIC_API_KEY never
// reaches the browser — the client calls this endpoint instead of the
// Anthropic API directly.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const { base64Data, mimeType, columns, customInstructions, pageRange } = req.body as ExtractRequestBody;

  if (!base64Data || !mimeType || !Array.isArray(columns)) {
    res.status(400).json({ error: 'Missing required fields: base64Data, mimeType, columns.' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const items = await extractInvoiceItems(client, { base64Data, mimeType, columns, customInstructions, pageRange });
    res.status(200).json({ items });
  } catch (error) {
    console.error('Claude API Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /not valid JSON|No text response/.test(message) ? 502 : 500;
    res.status(status).json({ error: message });
  }
}
