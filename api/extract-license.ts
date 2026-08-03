import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { extractLicenseItems } from '../lib/extractInvoice.js';

export const config = {
  maxDuration: 60,
};

interface ExtractLicenseRequestBody {
  base64Data: string;
  mimeType: string;
  fileName?: string;
  format: 'base' | 'term-dated';
  customInstructions: string;
  focusItems?: string[];
}

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

  const { base64Data, mimeType, fileName, format, customInstructions, focusItems } = req.body as ExtractLicenseRequestBody;

  if (!base64Data || !mimeType || (format !== 'base' && format !== 'term-dated')) {
    res.status(400).json({ error: 'Missing required fields: base64Data, mimeType, format ("base" or "term-dated").' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const result = await extractLicenseItems(client, { base64Data, mimeType, fileName, format, customInstructions, focusItems });
    res.status(200).json(result);
  } catch (error) {
    console.error('Claude license extraction error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /not valid JSON|No text response/.test(message) ? 502 : 500;
    res.status(status).json({ error: message });
  }
}
