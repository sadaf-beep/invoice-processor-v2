// Talks to Supabase's auto-generated PostgREST API directly via fetch — no
// @supabase/supabase-js dependency, matching this project's pattern of thin
// hand-rolled REST clients (see gmailClient.ts, driveClient.ts) over SDKs.
//
// Backs the adjustable "run at HH:MM" schedule shown in the Automate panel.
// Vercel Cron itself can't be rescheduled at runtime (its time is fixed in
// vercel.json at deploy time), so instead the cron fires every 15 minutes
// and checks this single settings row to decide whether it's actually time
// to run yet.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface AutomationSettings {
  enabled: boolean;
  runHour: number; // 0-23, local to `timezone`
  runMinute: number; // 0-59
  timezone: string; // IANA name, e.g. "Asia/Dhaka"
  lastRunDate: string | null; // YYYY-MM-DD, local to `timezone`
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function headers() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY as string,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function rowToSettings(row: any): AutomationSettings {
  return {
    enabled: row?.enabled ?? false,
    runHour: row?.run_hour ?? 6,
    runMinute: row?.run_minute ?? 0,
    timezone: row?.timezone ?? 'Asia/Dhaka',
    lastRunDate: row?.last_run_date ?? null,
  };
}

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/automation_settings?id=eq.1&select=*`, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rowToSettings(rows[0]);
}

export async function updateAutomationSettings(
  patch: Partial<{ enabled: boolean; runHour: number; runMinute: number }>
): Promise<AutomationSettings> {
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.runHour !== undefined) body.run_hour = patch.runHour;
  if (patch.runMinute !== undefined) body.run_minute = patch.runMinute;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/automation_settings?id=eq.1`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rowToSettings(rows[0]);
}

export async function markRanToday(dateStr: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/automation_settings?id=eq.1`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ last_run_date: dateStr }),
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
}

// The scheduled hour/minute are local to `timezone`, but the server runs in
// UTC — Intl.DateTimeFormat with a timeZone option converts without needing
// a date library.
export function nowInTimezone(timezone: string): { hour: number; minute: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = parseInt(get('hour'), 10) % 24;
  return { hour, minute: parseInt(get('minute'), 10), dateStr: `${get('year')}-${get('month')}-${get('day')}` };
}
