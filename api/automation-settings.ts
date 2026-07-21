import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAutomationSettings, updateAutomationSettings, isSupabaseConfigured } from '../lib/automationSettings.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isSupabaseConfigured()) {
    res.status(500).json({ error: 'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const settings = await getAutomationSettings();
      res.status(200).json(settings);
      return;
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const { enabled, runHour, runMinute } = req.body || {};
      const patch: Partial<{ enabled: boolean; runHour: number; runMinute: number }> = {};
      if (typeof enabled === 'boolean') patch.enabled = enabled;
      if (typeof runHour === 'number' && runHour >= 0 && runHour <= 23) patch.runHour = runHour;
      if (typeof runMinute === 'number' && runMinute >= 0 && runMinute <= 59) patch.runMinute = runMinute;
      const settings = await updateAutomationSettings(patch);
      res.status(200).json(settings);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
