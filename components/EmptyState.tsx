import React from 'react';
import { Sparkles, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { ColumnConfig } from '../types';

interface EmptyStateProps {
  onExtract: () => void;
  onAddRow: () => void;
  columns: ColumnConfig[];
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onExtract, onAddRow, columns }) => (
  <div
    className="h-full w-full flex flex-col items-center justify-center px-6 text-center"
    style={{ background: 'radial-gradient(120% 90% at 50% -10%, var(--color-brand-soft), transparent 60%)' }}
  >
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-lg w-full"
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-5 shadow-[0_12px_30px_-8px_var(--color-brand-shadow)]"
        style={{ background: 'linear-gradient(150deg, #D0714B, #B04E2D)' }}
      >
        <Sparkles className="text-white" size={26} />
      </div>

      <h1 className="text-[24px] font-extrabold tracking-tight text-[color:var(--color-ink)]">
        Turn invoices into clean rows
      </h1>
      <p className="text-[14px] text-[color:var(--color-ink-soft)] mt-2 max-w-md mx-auto leading-relaxed">
        Drop a vendor invoice and Claude extracts every line item into your standard columns — classified,
        priced, and ready for review.
      </p>

      <div className="flex items-center justify-center gap-3 mt-7">
        <button onClick={onExtract} className="btn-primary h-11 px-5 text-[14px] rounded-xl">
          <Sparkles size={16} /> Extract your first invoice
        </button>
      </div>
      <p className="text-[12px] text-[color:var(--color-ink-muted)] mt-3">
        or drag a PDF anywhere onto this window
      </p>
      <button onClick={onAddRow} className="text-[12px] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-brand)] mt-1 underline underline-offset-2 transition-colors">
        start with a blank row instead
      </button>

      <div className="mt-9">
        <div className="flex items-center justify-center gap-1.5 mb-3">
          <span className="lock-tag"><Lock size={11} /> Standard columns — filled automatically</span>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {columns.map((col) => (
            <span key={col.id} className="rchip">{col.label}</span>
          ))}
        </div>
      </div>
    </motion.div>
  </div>
);
