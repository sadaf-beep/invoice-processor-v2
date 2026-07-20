import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-[color:var(--color-positive)]" />,
  error: <AlertCircle size={18} className="text-[color:var(--color-danger)]" />,
  info: <Info size={18} className="text-[color:var(--color-brand)]" />,
};

const ToastRow: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (toast.kind === 'error') return; // errors stay until dismissed
    const t = setTimeout(() => onDismiss(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
      className="w-80 rounded-xl bg-white border border-[color:var(--color-line)] shadow-[0_10px_30px_-12px_rgba(28,25,23,0.3)] px-4 py-3 flex items-start gap-3"
    >
      <div className="mt-0.5 shrink-0">{ICONS[toast.kind]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[color:var(--color-ink)] leading-tight">{toast.title}</p>
        {toast.detail && <p className="text-[12px] text-[color:var(--color-ink-soft)] leading-snug mt-0.5 break-words">{toast.detail}</p>}
      </div>
      <button onClick={() => onDismiss(toast.id)} className="tbtn h-6 w-6 shrink-0">
        <X size={13} />
      </button>
    </motion.div>
  );
};

export const Toaster: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 items-end pointer-events-none">
    <AnimatePresence>
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastRow toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </AnimatePresence>
  </div>
);
