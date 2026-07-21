import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDailyAutomation } from '../../lib/runDailyAutomation.js';
import { getAutomationSettings, markRanToday, nowInTimezone, isSupabaseConfigured } from '../../lib/automationSettings.js';

export const config = {
  maxDuration: 60,
};

// Vercel invokes cron jobs with an "Authorization: Bearer <CRON_SECRET>"
// header when CRON_SECRET is set — this rejects any other caller so an
// outsider can't trigger (and burn API budget on) this endpoint.
function isAuthorizedCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
    return;
  }

  // Vercel's Hobby plan caps cron jobs at once per day (a schedule firing
  // more often fails the *entire deployment*, not just this endpoint) — so
  // this fires once daily at the fixed UTC time in vercel.json. The
  // Automate panel's "enabled" toggle still fully gates whether this single
  // daily firing actually does anything; the run-time picker there is only
  // live if this project is on Vercel Pro or higher (which allows the cron
  // itself to poll more frequently and check a chosen time).
  if (!isSupabaseConfigured()) {
    // No settings store means no way to check "enabled" — skip rather than
    // run unconditionally on every fire.
    res.status(200).json({ skipped: 'Supabase not configured; automation settings unavailable.' });
    return;
  }

  try {
    const settings = await getAutomationSettings();
    if (!settings.enabled) {
      res.status(200).json({ skipped: 'disabled' });
      return;
    }

    const { dateStr } = nowInTimezone(settings.timezone);
    if (dateStr === settings.lastRunDate) {
      res.status(200).json({ skipped: 'already ran today', dateStr });
      return;
    }

    const result = await runDailyAutomation(anthropicKey);
    await markRanToday(dateStr);
    res.status(200).json(result);
  } catch (error) {
    console.error('Daily scan cron error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
