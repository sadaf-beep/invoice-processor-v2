import React, { useState, useRef, useEffect } from 'react';
import {
  X, Upload, FileText, Bot, Type, Hash, Calendar, Plus, Trash2, RotateCcw,
  CheckCircle2, AlertCircle, Loader2, Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ColumnConfig, Sheet, InvoiceItem } from '../types';
import { processInvoiceWithClaude } from '../services/claudeService';

interface ExtractPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDataReady: (items: InvoiceItem[], fileName: string, mode: 'single' | 'multiple', instructionsUsed: string) => void;
  onConfigChange: (columns: ColumnConfig[], instructions: string) => void;
  activeSheet: Sheet;
}

interface FileStatus {
  status: 'idle' | 'processing' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
}

export const ExtractPanel: React.FC<ExtractPanelProps> = ({ isOpen, onClose, onDataReady, onConfigChange, activeSheet }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [pageRange, setPageRange] = useState('All');
  const [outputMode, setOutputMode] = useState<'single' | 'multiple'>('single');
  const [newColName, setNewColName] = useState('');
  const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({});
  const [isProcessingGlobal, setIsProcessingGlobal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isProcessingGlobal && isOpen) {
      setFiles([]);
      setFileStatuses({});
    }
  }, [activeSheet.id, isOpen]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isProcessingGlobal) {
      interval = setInterval(() => {
        setFileStatuses((prev) => {
          const next = { ...prev };
          let changed = false;
          Object.keys(next).forEach((key) => {
            if (next[key].status === 'processing' && next[key].progress < 90) {
              next[key] = { ...next[key], progress: Math.min(90, next[key].progress + Math.random() * 5) };
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isProcessingGlobal]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files) as File[];
      setFiles((prev) => [...prev, ...newFiles]);
      setFileStatuses((prev) => {
        const next = { ...prev };
        newFiles.forEach((f) => {
          if (!next[f.name]) next[f.name] = { status: 'idle', progress: 0 };
        });
        return next;
      });
    }
  };

  const removeFile = (index: number) => {
    const fileToRemove = files[index];
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileStatuses((prev) => {
      const next = { ...prev };
      delete next[fileToRemove.name];
      return next;
    });
  };

  const clearAllFiles = () => {
    setFiles([]);
    setFileStatuses({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retryFile = (fileName: string) => {
    setFileStatuses((prev) => ({ ...prev, [fileName]: { status: 'idle', progress: 0, errorMessage: undefined } }));
  };

  const addColumn = () => {
    if (newColName.trim()) {
      const newCols = [...activeSheet.columns, { id: newColName, label: newColName, type: 'string', required: false } as ColumnConfig];
      onConfigChange(newCols, activeSheet.customInstructions);
      setNewColName('');
    }
  };

  const removeColumn = (id: string) => {
    onConfigChange(activeSheet.columns.filter((c) => c.id !== id), activeSheet.customInstructions);
  };

  const updateColumnType = (id: string, type: 'string' | 'number' | 'date') => {
    onConfigChange(activeSheet.columns.map((c) => (c.id === id ? { ...c, type } : c)), activeSheet.customInstructions);
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setIsProcessingGlobal(true);

    for (const file of files) {
      const currentStatus = fileStatuses[file.name];
      if (currentStatus?.status === 'success') continue;

      setFileStatuses((prev) => ({ ...prev, [file.name]: { status: 'processing', progress: 5 } }));

      try {
        const reader = new FileReader();
        await new Promise<void>((resolve, reject) => {
          reader.onload = async () => {
            try {
              const base64 = reader.result as string;
              const result = await processInvoiceWithClaude(base64, file.type, activeSheet.columns, activeSheet.customInstructions, pageRange);
              onDataReady(result, file.name, outputMode, activeSheet.customInstructions);
              setFileStatuses((prev) => ({ ...prev, [file.name]: { status: 'success', progress: 100 } }));
              resolve();
            } catch (e) {
              reject(e);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      } catch (error) {
        setFileStatuses((prev) => ({ ...prev, [file.name]: { status: 'error', progress: 0, errorMessage: String(error) } }));
      }
    }
    setIsProcessingGlobal(false);
  };

  const getStatusIcon = (status: FileStatus['status']) => {
    switch (status) {
      case 'processing':
        return <Loader2 size={15} className="animate-spin text-brand" />;
      case 'success':
        return <CheckCircle2 size={15} className="text-emerald-500" />;
      case 'error':
        return <AlertCircle size={15} className="text-red-500" />;
      default:
        return <FileText size={15} className="text-slate-400" />;
    }
  };

  const doneCount = (Object.values(fileStatuses) as FileStatus[]).filter((s) => s.status === 'success').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/20 z-40"
          />
          <motion.div
            initial={{ x: 440 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
            className="fixed top-0 right-0 h-full w-[440px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-brand p-2 rounded-lg">
                  <Bot className="text-white w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-[14px] font-bold text-slate-800 leading-tight">Extract Data</h2>
                  <p className="text-[11px] text-slate-400 leading-tight">Into <span className="text-brand font-medium">{activeSheet.name}</span></p>
                </div>
              </div>
              <button onClick={onClose} className="toolbar-btn text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {/* Source */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Files</h3>
                  {files.length > 0 && (
                    <button onClick={clearAllFiles} disabled={isProcessingGlobal} className="text-[11px] font-medium text-red-500 hover:underline">
                      Clear all
                    </button>
                  )}
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-xl px-4 py-6 flex flex-col items-center justify-center text-center hover:border-brand hover:bg-brand-soft cursor-pointer transition-colors"
                >
                  <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileChange} />
                  <Upload className="w-6 h-6 text-slate-400 mb-2" />
                  <p className="text-[13px] font-semibold text-slate-700">Click to upload or drag and drop</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">PDF, JPG or PNG · up to 100 files</p>
                </div>

                {files.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {files.map((f, i) => {
                      const s = fileStatuses[f.name] || { status: 'idle', progress: 0 };
                      return (
                        <div
                          key={f.name}
                          className={`px-3 py-2 rounded-lg border flex flex-col gap-1.5 group
                            ${s.status === 'processing' ? 'bg-brand-soft border-blue-200' :
                              s.status === 'success' ? 'bg-emerald-50 border-emerald-100' :
                              s.status === 'error' ? 'bg-red-50 border-red-100' :
                              'bg-slate-50 border-slate-100'}
                          `}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {getStatusIcon(s.status)}
                              <span className="truncate text-[12px] font-medium text-slate-700">{f.name}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {s.status === 'error' && (
                                <button onClick={() => retryFile(f.name)} className="toolbar-btn text-brand"><RotateCcw size={13} /></button>
                              )}
                              {s.status !== 'processing' && (
                                <button onClick={() => removeFile(i)} className="toolbar-btn text-slate-400 hover:text-red-500"><X size={13} /></button>
                              )}
                            </div>
                          </div>
                          {s.status === 'processing' && (
                            <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                              <div className="bg-brand h-full transition-all" style={{ width: `${s.progress}%` }} />
                            </div>
                          )}
                          {s.status === 'error' && s.errorMessage && (
                            <p className="text-[11px] text-red-600 leading-snug break-words">{s.errorMessage}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Output mode */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Output</h3>
                <div className="space-y-2">
                  {(['single', 'multiple'] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="radio" checked={outputMode === mode} onChange={() => setOutputMode(mode)} className="peer sr-only" />
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${outputMode === mode ? 'border-brand border-[5px]' : 'border-slate-300'}`} />
                      <span className="text-[13px] text-slate-700">
                        {mode === 'single' ? 'Append to active sheet' : 'Create a new sheet per file'}
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              {/* Columns */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Columns to extract</h3>
                <div className="flex flex-wrap gap-1.5">
                  {activeSheet.columns.map((col) => (
                    <div key={col.id} className="flex items-center gap-1 bg-slate-100 border border-slate-200 pl-2.5 pr-1.5 py-1 rounded-md text-[11.5px] font-medium text-slate-600">
                      <span>{col.label}</span>
                      <button onClick={() => updateColumnType(col.id, col.type === 'string' ? 'number' : col.type === 'number' ? 'date' : 'string')} className="p-0.5 text-slate-400 hover:text-brand">
                        {col.type === 'string' && <Type size={11} />}
                        {col.type === 'number' && <Hash size={11} />}
                        {col.type === 'date' && <Calendar size={11} />}
                      </button>
                      <button onClick={() => removeColumn(col.id)} className="text-slate-400 hover:text-red-500"><X size={11} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="New column name…"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  />
                  <button onClick={addColumn} className="p-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700"><Plus size={15} /></button>
                </div>
              </section>

              {/* Extra instructions */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Extra instructions</h3>
                <textarea
                  className="w-full h-24 border border-slate-200 rounded-lg p-3 text-[12.5px] outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
                  placeholder="e.g. Ignore shipping rows entirely. Convert EUR to USD."
                  value={activeSheet.customInstructions}
                  onChange={(e) => onConfigChange(activeSheet.columns, e.target.value)}
                />
              </section>

              {/* Page range */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Page range</h3>
                <input
                  type="text"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder="Leave blank for all pages, or e.g. 1-3, 5"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] font-mono outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </section>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 shrink-0 space-y-3">
              <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
                <Sparkles size={11} className="text-brand" /> Powered by Claude Opus
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 text-slate-600 font-semibold text-[13px] hover:bg-slate-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={processFiles}
                  disabled={files.length === 0 || isProcessingGlobal}
                  className="flex-[2] px-4 py-2.5 bg-brand text-white rounded-lg font-semibold text-[13px] shadow-sm hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                >
                  {isProcessingGlobal ? (
                    <>
                      <Loader2 className="animate-spin" size={15} /> Processing {doneCount}/{files.length}…
                    </>
                  ) : (
                    <>Process {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'files'}</>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
