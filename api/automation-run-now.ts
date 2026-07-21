import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDailyAutomation } from '../lib/runDailyAutomation.js';

// Manual trigger for the "Run automation now" button in the Automate panel
// — runs the exact same pipeline as the cron job, immediately, ignoring the
// schedule entirely. Lets you test or demo the automation without waiting
// for the scheduled time. Safe to fire repeatedly: Gmail dedup labeling
// means already-processed invoices are simply skipped, not reprocessed.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
    return;
  }

  try {
    const result = await runDailyAutomation(anthropicKey);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
