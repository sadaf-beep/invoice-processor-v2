import React, { useState, useRef, useEffect } from 'react';
import {
  X, UploadCloud, FileText, Bot, Lock, RotateCcw,
  CheckCircle2, AlertCircle, Loader2, Sparkles, Mail, MailX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ColumnConfig, Sheet, InvoiceItem } from '../types';
import { processInvoiceWithClaude } from '../services/claudeService';
import { scanGmailForInvoices, GmailScanMessageResult } from '../services/gmailService';

interface ExtractPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDataReady: (items: InvoiceItem[], fileName: string, mode: 'single' | 'multiple', instructionsUsed: string) => void;
  onConfigChange: (columns: ColumnConfig[], instructions: string) => void;
  onError: (fileName: string, message: string) => void;
  activeSheet: Sheet;
  /** Files dropped on the window while the panel was closed — preloaded once the panel opens. */
  pendingFiles: File[] | null;
  onPendingFilesConsumed: () => void;
}

interface FileStatus {
  status: 'idle' | 'processing' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
}

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

const cleanErr = (e: unknown): string => {
  let s = e instanceof Error ? e.message : String(e);
  s = s.replace(/^Error:\s*/i, '').trim();
  return s || 'Something went wrong.';
};

// Every scanned email's subject starts with the same required "Invoice
// Uploaded" phrase, so the sheet-name truncation elsewhere (first 20 chars)
// would make every tab look identical. Strip that fixed prefix so whatever's
// actually distinctive (vendor, date) lands within the truncation window.
const sheetNameFromSubject = (subject: string, messageId: string): string => {
  const stripped = subject.replace(/^invoice uploaded\s*[|:\-–—]?\s*/i, '').trim();
  return stripped || `Gmail ${messageId.slice(-6)}`;
};

export const ExtractPanel: React.FC<ExtractPanelProps> = ({ isOpen, onClose, onDataReady, onConfigChange, onError, activeSheet, pendingFiles, onPendingFilesConsumed }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [pageRange, setPageRange] = useState('All');
  const [outputMode, setOutputMode] = useState<'single' | 'multiple'>('single');
  const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({});
  const [isProcessingGlobal, setIsProcessingGlobal] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [source, setSource] = useState<'upload' | 'gmail'>('upload');
  const [daysBack, setDaysBack] = useState(7);
  const [isScanningGmail, setIsScanningGmail] = useState(false);
  const [gmailResults, setGmailResults] = useState<GmailScanMessageResult[] | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailDebug, setGmailDebug] = useState<{ account: string; query: string; matchCount: number; labelError?: string | null } | null>(null);

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

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter((f) => ACCEPTED.includes(f.type));
    if (valid.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !existing.has(f.name))];
    });
    setFileStatuses((prev) => {
      const next = { ...prev };
      valid.forEach((f) => {
        if (!next[f.name]) next[f.name] = { status: 'idle', progress: 0 };
      });
      return next;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files) as File[]);
  };

  useEffect(() => {
    if (pendingFiles && pendingFiles.length > 0) {
      addFiles(pendingFiles);
      onPendingFilesConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFiles]);

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
        const msg = cleanErr(error);
        setFileStatuses((prev) => ({ ...prev, [file.name]: { status: 'error', progress: 0, errorMessage: msg } }));
        onError(file.name, msg);
      }
    }
    setIsProcessingGlobal(false);
  };

  const handleGmailScan = async () => {
    setIsScanningGmail(true);
    setGmailError(null);
    setGmailResults(null);
    setGmailDebug(null);
    try {
      const { messages, debug } = await scanGmailForInvoices(activeSheet.columns, activeSheet.customInstructions, daysBack);
      setGmailResults(messages);
      if (debug) setGmailDebug(debug);
      // One onDataReady call per email — not a single combined call — so
      // "New sheet per file" actually produces one sheet per invoice instead
      // of dumping every email's rows into one sheet.
      messages
        .filter((m) => m.status === 'processed' && m.items.length > 0)
        .forEach((m) => onDataReady(m.items, sheetNameFromSubject(m.subject, m.id), outputMode, activeSheet.customInstructions));
    } catch (error) {
      const msg = cleanErr(error);
      setGmailError(msg);
      onError('Gmail scan', msg);
    }
    setIsScanningGmail(false);
  };

  const getStatusIcon = (status: FileStatus['status']) => {
    switch (status) {
      case 'processing': return <Loader2 size={15} className="animate-spin text-[color:var(--color-brand)]" />;
      case 'success': return <CheckCircle2 size={15} className="text-[color:var(--color-positive)]" />;
      case 'error': return <AlertCircle size={15} className="text-[color:var(--color-danger)]" />;
      default: return <FileText size={15} className="text-[color:var(--color-ink-muted)]" />;
    }
  };

  const doneCount = (Object.values(fileStatuses) as FileStatus[]).filter((s) => s.status === 'success').length;
  const sectionLabel = "text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-muted)]";

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
            {/* Header */}
            <div className="px-5 py-4 border-b border-[color:var(--color-line)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: 'linear-gradient(150deg, #D0714B, #B04E2D)' }}>
                  <Bot className="text-white w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-[14px] font-bold text-[color:var(--color-ink)] leading-tight">Extract Data</h2>
                  <p className="text-[11px] text-[color:var(--color-ink-muted)] leading-tight mt-0.5">
                    Into <span className="text-[color:var(--color-brand)] font-semibold">{activeSheet.name}</span>
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="tbtn"><X size={18} /></button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
              {/* Source */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className={sectionLabel}>Source</h3>
                  {source === 'upload' && files.length > 0 && (
                    <button onClick={clearAllFiles} disabled={isProcessingGlobal} className="text-[11px] font-semibold text-[color:var(--color-danger)] hover:underline disabled:opacity-40">
                      Clear all
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[color:var(--color-surface-sunken)]">
                  <button
                    onClick={() => setSource('upload')}
                    className={`h-8 rounded-md text-[12.5px] font-semibold transition-colors flex items-center justify-center gap-1.5
                      ${source === 'upload' ? 'bg-[color:var(--color-surface)] text-[color:var(--color-ink)] shadow-sm' : 'text-[color:var(--color-ink-muted)]'}`}
                  >
                    <UploadCloud size={13} /> Upload files
                  </button>
                  <button
                    onClick={() => setSource('gmail')}
                    className={`h-8 rounded-md text-[12.5px] font-semibold transition-colors flex items-center justify-center gap-1.5
                      ${source === 'gmail' ? 'bg-[color:var(--color-surface)] text-[color:var(--color-ink)] shadow-sm' : 'text-[color:var(--color-ink-muted)]'}`}
                  >
                    <Mail size={13} /> Scan Gmail
                  </button>
                </div>

                {source === 'upload' && (
                  <>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files) as File[]); }}
                      className={`rounded-xl px-4 py-7 flex flex-col items-center justify-center text-center cursor-pointer transition-colors border-2 border-dashed
                        ${dragOver ? 'border-[color:var(--color-brand)] bg-[color:var(--color-brand-soft)]' : 'border-[color:var(--color-line-strong)] hover:border-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-soft)]'}`}
                    >
                      <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileChange} />
                      <div className="w-10 h-10 rounded-xl bg-[color:var(--color-surface-sunken)] flex items-center justify-center mb-2.5">
                        <UploadCloud className="w-5 h-5 text-[color:var(--color-ink-soft)]" />
                      </div>
                      <p className="text-[13px] font-semibold text-[color:var(--color-ink)]">Click to upload or drag & drop</p>
                      <p className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5">PDF, JPG or PNG · up to 100 files</p>
                    </div>

                    {files.length > 0 && (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                        {files.map((f, i) => {
                          const s = fileStatuses[f.name] || { status: 'idle', progress: 0 };
                          return (
                            <div
                              key={f.name}
                              className={`px-3 py-2 rounded-lg border flex flex-col gap-1.5 group
                                ${s.status === 'processing' ? 'bg-[color:var(--color-brand-soft)] border-[color:var(--color-brand-border)]' :
                                  s.status === 'success' ? 'bg-[color:var(--color-positive-soft)] border-[color:var(--color-line)]' :
                                  s.status === 'error' ? 'bg-[color:var(--color-danger-soft)] border-[color:var(--color-line)]' :
                                  'bg-[color:var(--color-surface-sunken)] border-[color:var(--color-line)]'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {getStatusIcon(s.status)}
                                  <span className="truncate text-[12px] font-medium text-[color:var(--color-ink)]">{f.name}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  {s.status === 'error' && <button onClick={() => retryFile(f.name)} className="tbtn h-6 w-6 text-[color:var(--color-brand)]"><RotateCcw size={13} /></button>}
                                  {s.status !== 'processing' && <button onClick={() => removeFile(i)} className="tbtn h-6 w-6"><X size={13} /></button>}
                                </div>
                              </div>
                              {s.status === 'processing' && (
                                <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
                                  <div className="h-full transition-all" style={{ width: `${s.progress}%`, background: 'var(--color-brand)' }} />
                                </div>
                              )}
                              {s.status === 'error' && s.errorMessage && (
                                <p className="text-[11px] text-[color:var(--color-danger)] leading-snug break-words">{s.errorMessage}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {source === 'gmail' && (
                  <div className="space-y-3">
                    <div className="rounded-xl px-4 py-5 flex flex-col items-center text-center gap-1 border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)]">
                      <Mail className="w-5 h-5 text-[color:var(--color-ink-soft)] mb-1" />
                      <p className="text-[13px] font-semibold text-[color:var(--color-ink)]">Scans for emails subject-lined "Invoice Uploaded"</p>
                      <p className="text-[11px] text-[color:var(--color-ink-muted)]">Already-processed emails are skipped automatically.</p>
                    </div>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] font-medium text-[color:var(--color-ink-soft)]">Look back</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={daysBack}
                          onChange={(e) => setDaysBack(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                          className="w-16 h-8 px-2 rounded-md border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] text-[12.5px] numerical outline-none focus:border-[color:var(--color-brand)]"
                        />
                        <span className="text-[12.5px] text-[color:var(--color-ink-muted)]">days</span>
                      </div>
                    </label>

                    {gmailError && (
                      <div className="px-3 py-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-danger-soft)] flex items-start gap-2">
                        <AlertCircle size={14} className="text-[color:var(--color-danger)] shrink-0 mt-0.5" />
                        <p className="text-[11px] text-[color:var(--color-danger)] leading-snug break-words">{gmailError}</p>
                      </div>
                    )}

                    {gmailDebug && (
                      <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] space-y-1">
                        <p className="text-[10.5px] font-mono text-[color:var(--color-ink-muted)] break-all">Account: {gmailDebug.account}</p>
                        <p className="text-[10.5px] font-mono text-[color:var(--color-ink-muted)] break-all">Query: {gmailDebug.query}</p>
                        <p className="text-[10.5px] font-mono text-[color:var(--color-ink-muted)]">Matched: {gmailDebug.matchCount}</p>
                        {gmailDebug.labelError && (
                          <p className="text-[10.5px] font-mono text-[color:var(--color-danger)] break-all">
                            Dedup label unavailable this run (every match was reprocessed): {gmailDebug.labelError}
                          </p>
                        )}
                      </div>
                    )}

                    {gmailResults && (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                        {gmailResults.length === 0 && (
                          <p className="text-[12px] text-[color:var(--color-ink-muted)] text-center py-3">No new invoice emails found.</p>
                        )}
                        {gmailResults.map((m) => (
                          <div key={m.id} className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] flex items-start gap-2">
                            {m.status === 'processed' && <CheckCircle2 size={14} className="text-[color:var(--color-positive)] shrink-0 mt-0.5" />}
                            {m.status === 'skipped' && <MailX size={14} className="text-[color:var(--color-ink-muted)] shrink-0 mt-0.5" />}
                            {m.status === 'error' && <AlertCircle size={14} className="text-[color:var(--color-danger)] shrink-0 mt-0.5" />}
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-medium text-[color:var(--color-ink)]">{m.subject}</p>
                              <p className="text-[11px] text-[color:var(--color-ink-muted)]">
                                {m.status === 'processed' && `${m.itemCount} row${m.itemCount === 1 ? '' : 's'} extracted`}
                                {m.status === 'skipped' && 'No PDF attachment'}
                                {m.status === 'error' && (m.error || 'Failed')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Output mode */}
              <section className="space-y-2.5">
                <h3 className={sectionLabel}>Output</h3>
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { m: 'single' as const, label: 'Append to active sheet', desc: 'Add rows to the current sheet' },
                    { m: 'multiple' as const, label: 'New sheet per file', desc: 'Keep each invoice separate' },
                  ]).map(({ m, label, desc }) => (
                    <label
                      key={m}
                      className={`flex items-start gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors
                        ${outputMode === m ? 'border-[color:var(--color-brand)] bg-[color:var(--color-brand-soft)]' : 'border-[color:var(--color-line)] hover:bg-[color:var(--color-surface-sunken)]'}`}
                    >
                      <input type="radio" checked={outputMode === m} onChange={() => setOutputMode(m)} className="sr-only" />
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 ${outputMode === m ? 'border-[color:var(--color-brand)] border-[5px]' : 'border-[color:var(--color-line-strong)]'}`} />
                      <div className="leading-tight">
                        <div className="text-[13px] font-semibold text-[color:var(--color-ink)]">{label}</div>
                        <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5">{desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              {/* Columns — fixed schema, read-only */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className={sectionLabel}>Columns extracted</h3>
                  <span className="lock-tag"><Lock size={11} /> Fixed schema</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeSheet.columns.map((col) => (
                    <span key={col.id} className="rchip">{col.label}</span>
                  ))}
                </div>
              </section>

              {/* Extra instructions */}
              <section className="space-y-2.5">
                <h3 className={sectionLabel}>Extra instructions <span className="text-[color:var(--color-ink-muted)] font-medium normal-case tracking-normal">· optional</span></h3>
                <textarea
                  className="w-full h-24 border border-[color:var(--color-line-strong)] rounded-lg p-3 text-[12.5px] outline-none focus:ring-2 focus:ring-[color:var(--color-brand-border)] focus:border-[color:var(--color-brand)] resize-none bg-[color:var(--color-surface)]"
                  placeholder="e.g. Ignore shipping rows entirely. Convert EUR to USD."
                  value={activeSheet.customInstructions}
                  onChange={(e) => onConfigChange(activeSheet.columns, e.target.value)}
                />
              </section>

              {/* Page range — only meaningful for a single uploaded document */}
              {source === 'upload' && (
                <section className="space-y-2.5">
                  <h3 className={sectionLabel}>Page range</h3>
                  <input
                    type="text"
                    value={pageRange}
                    onChange={(e) => setPageRange(e.target.value)}
                    placeholder="All, or e.g. 1-3, 5"
                    className="w-full border border-[color:var(--color-line-strong)] rounded-lg px-3 py-2 text-[12.5px] numerical outline-none focus:ring-2 focus:ring-[color:var(--color-brand-border)] focus:border-[color:var(--color-brand)] bg-[color:var(--color-surface)]"
                  />
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[color:var(--color-line)] shrink-0 space-y-3 bg-[color:var(--color-surface)]">
              <div className="flex items-center gap-1.5 text-[10.5px] text-[color:var(--color-ink-muted)]">
                <Sparkles size={11} className="text-[color:var(--color-brand)]" /> Powered by Claude Opus
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 h-10 text-[color:var(--color-ink-soft)] font-semibold text-[13px] hover:bg-[color:var(--color-surface-sunken)] rounded-lg transition-colors">
                  Cancel
                </button>
                {source === 'upload' ? (
                  <button
                    onClick={processFiles}
                    disabled={files.length === 0 || isProcessingGlobal}
                    className="flex-[2] h-10 btn-primary justify-center text-[13px]"
                  >
                    {isProcessingGlobal ? (
                      <><Loader2 className="animate-spin" size={15} /> Processing {doneCount}/{files.length}…</>
                    ) : (
                      <><Sparkles size={15} /> Process {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'files'}</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleGmailScan}
                    disabled={isScanningGmail}
                    className="flex-[2] h-10 btn-primary justify-center text-[13px]"
                  >
                    {isScanningGmail ? (
                      <><Loader2 className="animate-spin" size={15} /> Scanning inbox…</>
                    ) : (
                      <><Mail size={15} /> Scan Gmail for invoices</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
