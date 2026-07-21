import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, listProcessedInvoices } from '../lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await ensureSchema();
    const runs = await listProcessedInvoices(200);
    res.status(200).json({ runs });
  } catch (error) {
    console.error('automation-runs error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
