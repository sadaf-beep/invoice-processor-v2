import React, { useEffect, useState } from 'react';
import { X, History, CheckCircle2, AlertCircle, MailX, FileText, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchAutomationRuns, AutomationRun } from '../services/automationService';

interface AutomationHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AutomationHistory: React.FC<AutomationHistoryProps> = ({ isOpen, onClose }) => {
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    fetchAutomationRuns()
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const grouped: [string, AutomationRun[]][] = [];
  if (runs) {
    const byDate = new Map<string, AutomationRun[]>();
    runs.forEach((r) => {
      const list = byDate.get(r.runDate) || [];
      list.push(r);
      byDate.set(r.runDate, list);
    });
    grouped.push(...byDate.entries());
  }

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
                  <History className="text-white w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-[14px] font-bold text-[color:var(--color-ink)] leading-tight">Automation History</h2>
                  <p className="text-[11px] text-[color:var(--color-ink-muted)] leading-tight mt-0.5">Daily Gmail scans, archived to Drive</p>
                </div>
              </div>
              <button onClick={onClose} className="tbtn"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-[color:var(--color-ink-muted)] text-[12.5px]">
                  <Loader2 className="animate-spin" size={16} /> Loading history…
                </div>
              )}

              {error && (
                <div className="px-3 py-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-danger-soft)] flex items-start gap-2">
                  <AlertCircle size={14} className="text-[color:var(--color-danger)] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[color:var(--color-danger)] leading-snug break-words">{error}</p>
                </div>
              )}

              {!loading && !error && grouped.length === 0 && (
                <p className="text-[12.5px] text-[color:var(--color-ink-muted)] text-center py-12">
                  No automated runs yet — either the daily scan hasn't fired, or the run turned up nothing new.
                </p>
              )}

              {grouped.map(([date, items]) => (
                <section key={date} className="space-y-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-muted)]">{date}</h3>
                  <div className="space-y-1.5">
                    {items.map((r) => (
                      <div key={r.id} className="px-3 py-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] flex items-start gap-2.5">
                        {r.status === 'processed' && <CheckCircle2 size={15} className="text-[color:var(--color-positive)] shrink-0 mt-0.5" />}
                        {r.status === 'skipped' && <MailX size={15} className="text-[color:var(--color-ink-muted)] shrink-0 mt-0.5" />}
                        {r.status === 'error' && <AlertCircle size={15} className="text-[color:var(--color-danger)] shrink-0 mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-[color:var(--color-ink)]">{r.fileName}</p>
                          <p className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5">
                            {r.status === 'processed' && `${r.itemCount} row${r.itemCount === 1 ? '' : 's'} extracted`}
                            {r.status === 'skipped' && 'No PDF attachment'}
                            {r.status === 'error' && (r.error || 'Failed')}
                          </p>
                          {(r.drivePdfLink || r.driveCsvLink) && (
                            <div className="flex items-center gap-3 mt-1.5">
                              {r.drivePdfLink && (
                                <a href={r.drivePdfLink} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[color:var(--color-brand)] hover:underline flex items-center gap-1">
                                  <FileText size={11} /> PDF
                                </a>
                              )}
                              {r.driveCsvLink && (
                                <a href={r.driveCsvLink} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[color:var(--color-brand)] hover:underline flex items-center gap-1">
                                  <FileText size={11} /> CSV
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
