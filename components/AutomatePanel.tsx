import React, { useState, useEffect, useCallback } from 'react';
import { X, Zap, Loader2, PlayCircle, Radio, Construction } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AutomatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (kind: 'success' | 'error', title: string, detail?: string) => void;
}

interface AutomationSettingsResponse {
  enabled: boolean;
  runHour: number;
  runMinute: number;
  timezone: string;
  lastRunDate: string | null;
  lastCheckedAt: string | null;
  lastResult: string | null;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function to12Hour(hour24: number): { hour12: number; ampm: 'AM' | 'PM' } {
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, ampm };
}

function to24Hour(hour12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export const AutomatePanel: React.FC<AutomatePanelProps> = ({ isOpen, onClose, onToast }) => {
  const [settings, setSettings] = useState<AutomationSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/automation-settings');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load automation settings');
      setSettings(body);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const save = async (patch: Partial<{ enabled: boolean; runHour: number; runMinute: number }>) => {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    setIsSaving(true);
    try {
      const res = await fetch('/api/automation-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      setSettings(body);
    } catch (err) {
      onToast('error', "Couldn't save automation settings", err instanceof Error ? err.message : String(err));
      load(); // roll back the optimistic update to whatever's actually saved
    }
    setIsSaving(false);
  };

  const runNow = async () => {
    setIsRunningNow(true);
    try {
      const res = await fetch('/api/automation-run-now', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Run failed');
      if (body.total === 0) {
        onToast('success', 'No new invoice emails found', 'Nothing to process right now.');
      } else {
        onToast('success', `Processed ${body.processed}/${body.total} invoice${body.total === 1 ? '' : 's'}`, 'Archived to Drive and emailed to you.');
      }
    } catch (err) {
      onToast('error', "Automation run failed", err instanceof Error ? err.message : String(err));
    }
    setIsRunningNow(false);
  };

  const sectionLabel = "text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-muted)]";
  const { hour12, ampm } = settings ? to12Hour(settings.runHour) : { hour12: 6, ampm: 'AM' as const };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(28,25,23,0.28)' }}
          />
          <motion.div
            initial={{ x: 460 }} animate={{ x: 0 }} exit={{ x: 460 }}
            transition={{ type: 'tween', duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-0 right-0 h-full w-[460px] max-w-[92vw] bg-[color:var(--color-surface)] border-l border-[color:var(--color-line)] shadow-[0_0_60px_-15px_rgba(28,25,23,0.35)] z-50 flex flex-col"
          >
            <div className="px-5 py-4 border-b border-[color:var(--color-line)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: 'linear-gradient(150deg, #D0714B, #B04E2D)' }}>
                  <Zap className="text-white w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-[14px] font-bold text-[color:var(--color-ink)] leading-tight">Automate</h2>
                  <p className="text-[11px] text-[color:var(--color-ink-muted)] leading-tight mt-0.5">
                    Daily inbox scan &amp; archive
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="tbtn"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
              {isLoading && (
                <div className="flex items-center justify-center py-10 text-[color:var(--color-ink-muted)]">
                  <Loader2 className="animate-spin" size={20} />
                </div>
              )}

              {!isLoading && loadError && (
                <section className="space-y-3">
                  <div className="rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-[color:var(--color-surface-sunken)] px-4 py-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Construction size={16} className="text-[color:var(--color-brand)]" />
                      <h3 className="text-[13px] font-bold text-[color:var(--color-ink)]">Work in progress</h3>
                    </div>
                    <p className="text-[12.5px] text-[color:var(--color-ink-soft)] leading-relaxed">
                      This panel is meant to give you a fully unattended daily scan — an on/off switch and a
                      run-time picker right here, so the app automatically checks the inbox for new invoices
                      every morning, extracts them, archives the PDFs and CSVs to Google Drive, and emails you
                      a summary, with no one touching it.
                    </p>
                    <p className="text-[12.5px] text-[color:var(--color-ink-soft)] leading-relaxed">
                      The on/off toggle and schedule aren't connected yet in this deployment — they need a
                      small settings store (Supabase) that hasn't been set up here. Nothing is broken; this is
                      expected for now.
                    </p>
                    <p className="text-[12.5px] text-[color:var(--color-ink-soft)] leading-relaxed">
                      In the meantime, <strong>Run automation now</strong> below runs the real scan → extract
                      → archive → email pipeline on demand — that part works today regardless of this panel.
                    </p>
                    <p className="text-[10.5px] text-[color:var(--color-ink-muted)] pt-1 border-t border-[color:var(--color-line)]">
                      Technical detail: {loadError}
                    </p>
                  </div>
                </section>
              )}

              {!isLoading && settings && (
                <>
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-[13px] font-semibold text-[color:var(--color-ink)]">Process emails automatically</h3>
                        <p className="text-[11.5px] text-[color:var(--color-ink-muted)] mt-0.5">Scan the inbox and archive new invoices once a day.</p>
                      </div>
                      <button
                        onClick={() => save({ enabled: !settings.enabled })}
                        disabled={isSaving}
                        className={`switch ${settings.enabled ? 'on' : ''}`}
                      >
                        <div className="knob" />
                      </button>
                    </div>
                  </section>

                  <section className={`space-y-2.5 ${settings.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
                    <h3 className={sectionLabel}>Run time</h3>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={hour12}
                        onChange={(e) => save({ runHour: to24Hour(Number(e.target.value), ampm) })}
                        className="h-9 px-2 rounded-md border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] text-[12.5px] numerical outline-none focus:border-[color:var(--color-brand)]"
                      >
                        {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-[color:var(--color-ink-muted)]">:</span>
                      <select
                        value={settings.runMinute}
                        onChange={(e) => save({ runMinute: Number(e.target.value) })}
                        className="h-9 px-2 rounded-md border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] text-[12.5px] numerical outline-none focus:border-[color:var(--color-brand)]"
                      >
                        {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                      </select>
                      <select
                        value={ampm}
                        onChange={(e) => save({ runHour: to24Hour(hour12, e.target.value as 'AM' | 'PM') })}
                        className="h-9 px-2 rounded-md border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] text-[12.5px] outline-none focus:border-[color:var(--color-brand)]"
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                      <span className="text-[11px] text-[color:var(--color-ink-muted)] ml-1">{settings.timezone}</span>
                    </div>
                    <p className="text-[11px] text-[color:var(--color-ink-muted)]">
                      On the free Vercel plan, the scan actually fires once a day at a fixed time set in code
                      (not this picker) — saving here won't move the real fire time unless the project is on
                      Vercel Pro. Use <strong>Run automation now</strong> below for anything time-sensitive.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h3 className={sectionLabel}>Delivery</h3>
                    <p className="text-[12px] text-[color:var(--color-ink-soft)] leading-snug">
                      Processed invoices are archived to Google Drive and emailed to your connected Gmail account
                      — plus a Slack message if configured.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h3 className={sectionLabel}>Last check-in</h3>
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)]">
                      <Radio size={14} className="text-[color:var(--color-ink-muted)] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {settings.lastCheckedAt ? (
                          <>
                            <p className="text-[12px] font-medium text-[color:var(--color-ink)]">
                              {new Date(settings.lastCheckedAt).toLocaleString()}
                            </p>
                            <p className="text-[11.5px] text-[color:var(--color-ink-muted)] mt-0.5 break-words">{settings.lastResult}</p>
                          </>
                        ) : (
                          <p className="text-[12px] text-[color:var(--color-ink-muted)]">
                            No check-in yet — this fills in the first time the scheduled scan fires.
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-[color:var(--color-ink-muted)]">
                      Updated every time the daily cron actually invokes, whether it ran, skipped, or errored —
                      the reliable way to confirm it fired, since Vercel's free-plan logs don't stick around.
                    </p>
                  </section>
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[color:var(--color-line)] shrink-0 space-y-3 bg-[color:var(--color-surface)]">
              <button
                onClick={runNow}
                disabled={isRunningNow || isLoading}
                className="w-full h-10 btn-primary justify-center text-[13px]"
              >
                {isRunningNow ? (
                  <><Loader2 className="animate-spin" size={15} /> Running…</>
                ) : (
                  <><PlayCircle size={15} /> Run automation now</>
                )}
              </button>
              <p className="text-[10.5px] text-[color:var(--color-ink-muted)] text-center">
                Runs the full scan right now, regardless of the schedule above — handy for testing or a demo.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
