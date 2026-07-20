import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sparkles, Plus, X, Undo, Redo, Bold, Italic,
  AlignLeft, AlignCenter, AlignRight, Trash2, ChevronDown, Download,
  Eraser, BookOpen, FileSpreadsheet, FileText, Search, Sun, Moon, UploadCloud,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadSOP } from './lib/sopGenerator';
import { ExtractPanel } from './components/ExtractPanel';
import { Spreadsheet } from './components/Spreadsheet';
import { EmptyState } from './components/EmptyState';
import { Toaster, Toast, ToastKind } from './components/Toast';
import { InvoiceItem, ColumnConfig, DEFAULT_COLUMNS, Sheet, DEFAULT_INSTRUCTIONS, CellStyle } from './types';
import { generateExcel, generateCSV } from './services/excelService';

interface HistoryState {
  data: InvoiceItem[];
  styles: Record<string, CellStyle>;
  columns: ColumnConfig[];
}

const TYPE_FILTERS: { key: string; match: string | null }[] = [
  { key: 'All', match: null },
  { key: 'Asset', match: 'ASSET' },
  { key: 'Bulk', match: 'BULK ITEM' },
  { key: 'Labour', match: 'LABOUR' },
  { key: 'Shipping', match: 'SHIPPING' },
  { key: 'Prepaid', match: 'PREPAID' },
];

let toastSeq = 0;

const App: React.FC = () => {
  const [sheets, setSheets] = useState<Sheet[]>([
    { id: '1', name: 'Sheet1', data: [], columns: DEFAULT_COLUMNS, customInstructions: DEFAULT_INSTRUCTIONS, styles: {} },
  ]);
  const [activeSheetId, setActiveSheetId] = useState<string>('1');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ r: number; c: string } | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'view' | 'export' | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [tempTabName, setTempTabName] = useState('');

  const [history, setHistory] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });
  const [typeFilter, setTypeFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragDepth, setDragDepth] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const activeSheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];
  const rowCount = activeSheet.data.filter((r) => Object.values(r).some((v) => v !== '' && v != null)).length;
  const isEmpty = activeSheet.data.length === 0;

  // Type counts + running total across the whole sheet (unaffected by search/filter)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activeSheet.data.forEach((row) => {
      const t = String(row['Item Type'] || '').toUpperCase();
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [activeSheet.data]);

  const totalValue = useMemo(() => {
    return activeSheet.data.reduce((sum, row) => {
      const v = parseFloat(String(row['Purchase Price'] ?? ''));
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }, [activeSheet.data]);

  const hasActiveFilter = typeFilter !== 'All' || searchQuery.trim() !== '';
  const visibleIndices = useMemo(() => {
    if (!hasActiveFilter) return undefined;
    const q = searchQuery.trim().toLowerCase();
    const matchType = TYPE_FILTERS.find((f) => f.key === typeFilter)?.match;
    return activeSheet.data
      .map((_, i) => i)
      .filter((i) => {
        const row = activeSheet.data[i];
        const typeOk = !matchType || String(row['Item Type'] || '').toUpperCase() === matchType;
        const searchOk = !q || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
        return typeOk && searchOk;
      });
  }, [activeSheet.data, typeFilter, searchQuery, hasActiveFilter]);

  const pushToast = (kind: ToastKind, title: string, detail?: string) => {
    setToasts((prev) => [...prev, { id: `t${++toastSeq}`, kind, title, detail }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const snapshot = (sheet: Sheet): HistoryState => ({
    data: JSON.parse(JSON.stringify(sheet.data)),
    styles: JSON.parse(JSON.stringify(sheet.styles)),
    columns: JSON.parse(JSON.stringify(sheet.columns)),
  });

  const saveToHistory = () => {
    setHistory((prev) => [...prev.slice(-20), snapshot(activeSheet)]);
    setFuture([]);
  };

  const updateActiveSheet = (updates: Partial<Sheet>, recordHistory = true) => {
    if (recordHistory) saveToHistory();
    setSheets(sheets.map((s) => (s.id === activeSheetId ? { ...s, ...updates } : s)));
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture((prev) => [snapshot(activeSheet), ...prev]);
    updateActiveSheet({ data: previous.data, styles: previous.styles, columns: previous.columns }, false);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setHistory((prev) => [...prev, snapshot(activeSheet)]);
    updateActiveSheet({ data: next.data, styles: next.styles, columns: next.columns }, false);
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all data in this sheet?')) {
      updateActiveSheet({ data: [], styles: {} });
    }
  };

  const handleDeleteRow = () => {
    if (selectedRowIndex !== null) {
      const newData = [...activeSheet.data];
      newData.splice(selectedRowIndex, 1);
      updateActiveSheet({ data: newData });
      setSelectedRowIndex(null);
    }
  };

  const handleAddRow = () => {
    updateActiveSheet({ data: [...activeSheet.data, {}] });
  };

  const handleBatchChange = (updates: { r: number; c: string; v: string }[]) => {
    const newData = [...activeSheet.data];
    updates.forEach(({ r, c, v }) => {
      if (!newData[r]) newData[r] = {};
      newData[r] = { ...newData[r], [c]: v };
    });
    updateActiveSheet({ data: newData });
  };

  const applyStyle = (styleUpdate: Partial<CellStyle>) => {
    if (!selectedCell && selectedRowIndex === null) return;
    saveToHistory();
    const newStyles = { ...activeSheet.styles };

    if (selectedRowIndex !== null && !selectedCell) {
      activeSheet.columns.forEach((col) => {
        const key = `${selectedRowIndex}-${col.id}`;
        newStyles[key] = { ...newStyles[key], ...styleUpdate };
      });
    } else if (selectedCell) {
      const key = `${selectedCell.r}-${selectedCell.c}`;
      newStyles[key] = { ...newStyles[key], ...styleUpdate };
    }
    updateActiveSheet({ styles: newStyles }, false);
  };

  const handleDataReady = (items: InvoiceItem[], fileName: string, mode: 'single' | 'multiple', instructionsUsed: string) => {
    setSheets((prevSheets) => {
      if (mode === 'single') {
        return prevSheets.map((s) => {
          if (s.id === activeSheetId) {
            const isDefaultName = /^Sheet\d+$/.test(s.name);
            return { ...s, data: [...s.data, ...items], name: isDefaultName ? fileName.substring(0, 20) : s.name };
          }
          return s;
        });
      }
      const nextId = (Math.max(...prevSheets.map((s) => parseInt(s.id))) + 1).toString();
      const newSheet: Sheet = {
        id: nextId,
        name: fileName.substring(0, 20),
        data: items,
        columns: [...activeSheet.columns],
        customInstructions: instructionsUsed,
        styles: {},
      };
      return [...prevSheets, newSheet];
    });
    pushToast('success', `Extracted ${items.length} row${items.length === 1 ? '' : 's'}`, fileName);
  };

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null);
    if (activeMenu) window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenu]);

  // Page-wide drag & drop — drop a file anywhere to open the extract panel with it preloaded
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragDepth((d) => d + 1);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      setDragDepth((d) => Math.max(0, d - 1));
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragDepth(0);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      setPendingFiles(files);
      setIsPanelOpen(true);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const canFormat = selectedCell !== null || selectedRowIndex !== null;
  const isDraggingFile = dragDepth > 0;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
      {/* Top bar */}
      <header className="h-14 bg-[color:var(--color-surface)] border-b border-[color:var(--color-line)] flex items-center px-3 gap-1 shrink-0">
        <div className="flex items-center gap-2.5 mr-2 pl-1 shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(150deg, #D0714B, #B04E2D)' }}>
            <Sparkles className="text-white" size={15} />
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-bold text-[14px] text-[color:var(--color-ink)] tracking-tight">InvoiceIntel</span>
            <span className="text-[10px] text-[color:var(--color-ink-muted)] font-medium">AI extraction</span>
          </div>
        </div>

        <div className="w-px h-6 bg-[color:var(--color-line)] mx-1.5" />

        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'file' ? null : 'file'); }} className="tmenu">File</button>
          <AnimatePresence>
            {activeMenu === 'file' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="menu-pop left-0">
                <button onClick={() => downloadSOP()} className="menu-item"><BookOpen size={15} className="text-[color:var(--color-ink-muted)]" /> Download logic (PDF)</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={handleClearAll} className="menu-item" style={{ color: 'var(--color-danger)' }}><Eraser size={15} /> Clear sheet</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'edit' ? null : 'edit'); }} className="tmenu">Edit</button>
          <AnimatePresence>
            {activeMenu === 'edit' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="menu-pop left-0">
                <button onClick={handleUndo} disabled={history.length === 0} className="menu-item"><Undo size={15} className="text-[color:var(--color-ink-muted)]" /> Undo</button>
                <button onClick={handleRedo} disabled={future.length === 0} className="menu-item"><Redo size={15} className="text-[color:var(--color-ink-muted)]" /> Redo</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={handleDeleteRow} disabled={selectedRowIndex === null} className="menu-item"><Trash2 size={15} className="text-[color:var(--color-ink-muted)]" /> Delete row</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'view' ? null : 'view'); }} className="tmenu">View</button>
          <AnimatePresence>
            {activeMenu === 'view' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="menu-pop left-0">
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="menu-item">
                  {theme === 'dark' ? <Sun size={15} className="text-[color:var(--color-ink-muted)]" /> : <Moon size={15} className="text-[color:var(--color-ink-muted)]" />}
                  Switch to {theme === 'dark' ? 'light' : 'dark'} mode
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="w-px h-6 bg-[color:var(--color-line)] mx-1.5" />

        <button onClick={handleUndo} disabled={history.length === 0} className="tbtn" title="Undo"><Undo size={16} /></button>
        <button onClick={handleRedo} disabled={future.length === 0} className="tbtn" title="Redo"><Redo size={16} /></button>

        <div className="flex-1" />

        {/* Search */}
        {!isEmpty && (
          <div className="relative mr-2 hidden md:block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-ink-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${rowCount} items…`}
              className="h-8 w-56 pl-8 pr-3 rounded-md text-[12.5px] outline-none border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-muted)] focus:border-[color:var(--color-brand)] transition-colors"
            />
          </div>
        )}

        {/* Theme switch */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="theme-switch mr-2"
          title="Toggle light / dark"
        >
          <div className="knob">
            {theme === 'dark' ? <Moon size={11} className="text-[color:var(--color-brand)]" /> : <Sun size={11} className="text-[color:var(--color-warning)]" />}
          </div>
        </button>

        <div className="relative mr-1.5">
          <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'export' ? null : 'export'); }} className="btn-secondary">
            <Download size={14} /> Export <ChevronDown size={12} className="opacity-60" />
          </button>
          <AnimatePresence>
            {activeMenu === 'export' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="menu-pop right-0">
                <button onClick={() => generateExcel(activeSheet.data, activeSheet.columns, `${activeSheet.name}.xlsx`)} className="menu-item"><FileSpreadsheet size={15} className="text-[color:var(--color-positive)]" /> Export to Excel</button>
                <button onClick={() => generateCSV(activeSheet.data, activeSheet.columns, `${activeSheet.name}.csv`)} className="menu-item"><FileText size={15} className="text-[color:var(--color-ink-muted)]" /> Export to CSV</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={() => setIsPanelOpen(true)} className="btn-primary"><Sparkles size={14} /> Extract Data</button>
      </header>

      {/* Context strip — only once there's data */}
      {!isEmpty && (
        <div className="h-11 bg-[color:var(--color-canvas)] border-b border-[color:var(--color-line)] flex items-center px-3 gap-3 shrink-0 overflow-x-auto no-scrollbar">
          <span className="text-[12px] font-bold text-[color:var(--color-ink)] numerical shrink-0">{rowCount} item{rowCount === 1 ? '' : 's'}</span>
          <span className="text-[12px] text-[color:var(--color-ink-muted)] numerical shrink-0">
            · ${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} total
          </span>

          <div className="w-px h-5 bg-[color:var(--color-line)] shrink-0" />

          <div className="flex items-center gap-1.5 shrink-0">
            {TYPE_FILTERS.map(({ key, match }) => {
              const count = match ? (typeCounts[match] || 0) : rowCount;
              return (
                <button key={key} onClick={() => setTypeFilter(key)} className={`filter-chip ${typeFilter === key ? 'on' : ''}`}>
                  {key} <span className="n">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <div className={`flex items-center shrink-0 ${canFormat ? '' : 'opacity-40 pointer-events-none'}`}>
            <button onClick={() => applyStyle({ bold: true })} className="tbtn" title="Bold"><Bold size={15} /></button>
            <button onClick={() => applyStyle({ italic: true })} className="tbtn" title="Italic"><Italic size={15} /></button>
            <button onClick={() => applyStyle({ align: 'left' })} className="tbtn" title="Align left"><AlignLeft size={15} /></button>
            <button onClick={() => applyStyle({ align: 'center' })} className="tbtn" title="Align center"><AlignCenter size={15} /></button>
            <button onClick={() => applyStyle({ align: 'right' })} className="tbtn" title="Align right"><AlignRight size={15} /></button>
          </div>

          <button onClick={handleAddRow} className="btn-secondary shrink-0"><Plus size={14} /> Row</button>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 overflow-hidden relative">
        {isEmpty ? (
          <EmptyState onExtract={() => setIsPanelOpen(true)} onAddRow={handleAddRow} columns={activeSheet.columns} />
        ) : (
          <Spreadsheet
            data={activeSheet.data}
            columns={activeSheet.columns}
            styles={activeSheet.styles}
            visibleIndices={visibleIndices}
            onCellChange={(r, c, v) => {
              const newData = [...activeSheet.data];
              if (!newData[r]) newData[r] = {};
              newData[r] = { ...newData[r], [c]: v };
              updateActiveSheet({ data: newData });
            }}
            onBatchChange={handleBatchChange}
            onSelectionChange={(r, c) => {
              setSelectedRowIndex(r);
              setSelectedCell(c && r !== null ? { r, c } : null);
            }}
          />
        )}

        {/* Full-window drag overlay */}
        <AnimatePresence>
          {isDraggingFile && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
              style={{ background: 'rgba(193,95,60,0.08)' }}
            >
              <div className="border-2 border-dashed rounded-2xl px-10 py-8 flex flex-col items-center gap-2 bg-[color:var(--color-surface)]" style={{ borderColor: 'var(--color-brand)' }}>
                <UploadCloud size={28} className="text-[color:var(--color-brand)]" />
                <span className="text-[14px] font-semibold text-[color:var(--color-ink)]">Drop to extract</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Sheet tabs */}
      <div className="h-[38px] bg-[color:var(--color-surface)] border-t border-[color:var(--color-line)] flex items-center px-2 overflow-x-auto no-scrollbar shrink-0 select-none">
        <button
          onClick={() => {
            const newId = Date.now().toString();
            const newSheet: Sheet = { id: newId, name: `Sheet${sheets.length + 1}`, data: [{}], columns: [...DEFAULT_COLUMNS], customInstructions: DEFAULT_INSTRUCTIONS, styles: {} };
            setSheets([...sheets, newSheet]);
            setActiveSheetId(newId);
          }}
          className="tbtn mr-1 shrink-0"
          title="Add sheet"
        >
          <Plus size={15} />
        </button>

        {sheets.map((sheet) => (
          <div
            key={sheet.id}
            onClick={() => setActiveSheetId(sheet.id)}
            onDoubleClick={() => { setEditingTabId(sheet.id); setTempTabName(sheet.name); }}
            className={`group relative flex items-center gap-2 px-3.5 h-[30px] rounded-md text-[12.5px] cursor-pointer transition-colors mr-0.5
              ${activeSheetId === sheet.id ? 'text-[color:var(--color-ink)] font-semibold bg-[color:var(--color-brand-soft)]' : 'text-[color:var(--color-ink-soft)] hover:bg-[color:var(--color-surface-sunken)]'}`}
          >
            {editingTabId === sheet.id ? (
              <input
                autoFocus
                type="text"
                className="bg-transparent outline-none w-24 border-b border-[color:var(--color-brand)]"
                value={tempTabName}
                onChange={(e) => setTempTabName(e.target.value)}
                onBlur={() => { updateActiveSheet({ name: tempTabName || sheet.name }, false); setEditingTabId(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { updateActiveSheet({ name: tempTabName || sheet.name }, false); setEditingTabId(null); } }}
              />
            ) : (
              <>
                <span className="truncate max-w-[160px]">{sheet.name}</span>
                {sheets.length > 1 && (
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:text-[color:var(--color-danger)] transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete ${sheet.name}?`)) {
                        const idx = sheets.findIndex((s) => s.id === sheet.id);
                        const newSheets = sheets.filter((s) => s.id !== sheet.id);
                        if (activeSheetId === sheet.id) setActiveSheetId(newSheets[Math.max(0, idx - 1)].id);
                        setSheets(newSheets);
                      }
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <ExtractPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        onDataReady={handleDataReady}
        onConfigChange={(cols, inst) => updateActiveSheet({ columns: cols, customInstructions: inst })}
        onError={(fileName, msg) => pushToast('error', `Couldn't process ${fileName}`, msg)}
        activeSheet={activeSheet}
        pendingFiles={pendingFiles}
        onPendingFilesConsumed={() => setPendingFiles(null)}
      />

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default App;
