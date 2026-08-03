import React from 'react';
import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { ColumnConfig } from '../types';

interface EmptyStateProps {
  onExtract: () => void;
  onAddRow: () => void;
  columns: ColumnConfig[];
  /** A license sheet that came back with 0 rows would otherwise look
   *  identical to "no sheet exists" — this distinguishes that case instead
   *  of showing the generic asset-invoice pitch on every empty sheet. */
  kind?: 'asset' | 'license';
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onExtract, onAddRow, columns, kind = 'asset' }) => {
  const isLicense = kind === 'license';
  return (
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
          {isLicense ? 'This licence sheet came back empty' : 'Turn invoices into clean rows'}
        </h1>
        <p className="text-[14px] text-[color:var(--color-ink-soft)] mt-2 max-w-md mx-auto leading-relaxed">
          {isLicense
            ? "The sheet was created, but the extraction didn't find any licence line items in that document — it may not have had recognizable licence data, or the wrong layout/source was picked. Try re-extracting, or add a row manually below."
            : 'Drop a vendor invoice and Claude extracts every line item into your standard columns — classified, priced, and ready for review.'}
        </p>

        <div className="flex items-center justify-center gap-3 mt-7">
          <button onClick={onExtract} className="btn-primary h-11 px-5 text-[14px] rounded-xl">
            <Sparkles size={16} /> {isLicense ? 'Extract data' : 'Extract your first invoice'}
          </button>
        </div>
        {!isLicense && (
          <p className="text-[12px] text-[color:var(--color-ink-muted)] mt-3">
            or drag a PDF anywhere onto this window
          </p>
        )}
        <button onClick={onAddRow} className="text-[12px] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-brand)] mt-1 underline underline-offset-2 transition-colors">
          start with a blank row instead
        </button>

        <div className="mt-9">
          <div className="flex items-center justify-center gap-1.5 mb-3">
            <span className="lock-tag">{isLicense ? 'This sheet\'s licence columns' : 'Starting columns — add or rename any of them later'}</span>
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
};
