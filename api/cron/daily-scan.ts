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

  // This endpoint now fires every 15 minutes (see vercel.json) rather than
  // once a day, so the adjustable in-app time (Automate panel) can take
  // effect without a redeploy. Supabase holds the actual "run at HH:MM" the
  // user picked, and is the gate deciding whether this particular firing
  // should actually do anything.
  if (!isSupabaseConfigured()) {
    // No schedule store means no safe way to tell "is it time yet" — skip
    // rather than run the full pipeline on every 15-minute tick.
    res.status(200).json({ skipped: 'Supabase not configured; automation schedule unavailable.' });
    return;
  }

  try {
    const settings = await getAutomationSettings();
    if (!settings.enabled) {
      res.status(200).json({ skipped: 'disabled' });
      return;
    }

    const { hour, minute, dateStr } = nowInTimezone(settings.timezone);
    if (dateStr === settings.lastRunDate) {
      res.status(200).json({ skipped: 'already ran today', dateStr });
      return;
    }
    const nowMinutes = hour * 60 + minute;
    const scheduledMinutes = settings.runHour * 60 + settings.runMinute;
    if (nowMinutes < scheduledMinutes) {
      res.status(200).json({ skipped: 'not yet time', nowMinutes, scheduledMinutes });
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
