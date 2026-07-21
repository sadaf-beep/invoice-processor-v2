import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sparkles, Plus, X, Undo, Redo, Bold, Italic,
  AlignLeft, AlignCenter, AlignRight, Trash2,
  Eraser, BookOpen, FileSpreadsheet, FileText, Search, Sun, Moon, UploadCloud,
  FileUp, FolderArchive, ArrowUpToLine, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadSOP } from './lib/sopGenerator';
import { ExtractPanel } from './components/ExtractPanel';
import { AutomatePanel } from './components/AutomatePanel';
import { Spreadsheet } from './components/Spreadsheet';
import { EmptyState } from './components/EmptyState';
import { Toaster, Toast, ToastKind } from './components/Toast';
import { InvoiceItem, ColumnConfig, DEFAULT_COLUMNS, Sheet, DEFAULT_INSTRUCTIONS, CellStyle } from './types';
import { generateExcel, generateCSV, generateAllZip, parseCSVFile } from './services/excelService';

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
  const [isAutomatePanelOpen, setIsAutomatePanelOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ r: number; c: string } | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'view' | null>(null);
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
  const [sortConfig, setSortConfig] = useState<{ columnId: string; direction: 'asc' | 'desc' } | null>(null);

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
    if (!hasActiveFilter && !sortConfig) return undefined;

    let indices = activeSheet.data.map((_, i) => i);

    if (hasActiveFilter) {
      const q = searchQuery.trim().toLowerCase();
      const matchType = TYPE_FILTERS.find((f) => f.key === typeFilter)?.match;
      indices = indices.filter((i) => {
        const row = activeSheet.data[i];
        const typeOk = !matchType || String(row['Item Type'] || '').toUpperCase() === matchType;
        const searchOk = !q || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
        return typeOk && searchOk;
      });
    }

    if (sortConfig) {
      const col = activeSheet.columns.find((c) => c.id === sortConfig.columnId);
      if (col) {
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        indices = [...indices].sort((a, b) => {
          const va = activeSheet.data[a]?.[col.label];
          const vb = activeSheet.data[b]?.[col.label];
          if (col.type === 'number') {
            const na = parseFloat(String(va ?? '')) || 0;
            const nb = parseFloat(String(vb ?? '')) || 0;
            return (na - nb) * dir;
          }
          return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
        });
      }
    }

    return indices;
  }, [activeSheet.data, activeSheet.columns, typeFilter, searchQuery, hasActiveFilter, sortConfig]);

  const handleSortColumn = (columnId: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, direction: 'asc' };
      if (prev.direction === 'asc') return { columnId, direction: 'desc' };
      return null;
    });
  };

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

  const handleInsertRowAbove = () => {
    const at = selectedRowIndex ?? 0;
    const newData = [...activeSheet.data];
    newData.splice(at, 0, {});
    updateActiveSheet({ data: newData });
    setSelectedRowIndex(at);
  };

  const handleAddColumn = () => {
    const base = 'New Column';
    const existingIds = new Set(activeSheet.columns.map((c) => c.id.toLowerCase()));
    let name = base;
    let n = 2;
    while (existingIds.has(name.toLowerCase())) {
      name = `${base} ${n}`;
      n++;
    }
    const newCol: ColumnConfig = { id: name, label: name, type: 'string', required: false };
    updateActiveSheet({ columns: [...activeSheet.columns, newCol] });
  };

  const handleRenameColumn = (columnId: string, newLabel: string) => {
    const col = activeSheet.columns.find((c) => c.id === columnId);
    if (!col || col.label === newLabel) return;

    // Data and per-cell styles are keyed by the column's label/id, so a
    // rename has to migrate both — otherwise existing values and formatting
    // for that column silently vanish under the old key.
    const newData = activeSheet.data.map((row) => {
      if (!(col.label in row)) return row;
      const { [col.label]: value, ...rest } = row;
      return { ...rest, [newLabel]: value };
    });

    const newStyles: Record<string, CellStyle> = {};
    Object.entries(activeSheet.styles).forEach(([key, style]) => {
      const match = key.match(/^(\d+)-(.+)$/);
      newStyles[match && match[2] === col.id ? `${match[1]}-${newLabel}` : key] = style;
    });

    const newColumns = activeSheet.columns.map((c) => (c.id === columnId ? { ...c, id: newLabel, label: newLabel } : c));
    updateActiveSheet({ columns: newColumns, data: newData, styles: newStyles });
  };

  const handleDeleteColumn = (columnId: string) => {
    if (activeSheet.columns.length <= 1) return;
    if (!confirm('Delete this column? Its data will be removed from every row.')) return;
    updateActiveSheet({ columns: activeSheet.columns.filter((c) => c.id !== columnId) });
  };

  const handleResizeColumn = (columnId: string, width: number) => {
    updateActiveSheet({ columns: activeSheet.columns.map((c) => (c.id === columnId ? { ...c, width } : c)) }, false);
  };

  const csvInputRef = useRef<HTMLInputElement>(null);
  const handleImportCSVFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const items = await parseCSVFile(file, activeSheet.columns);
      updateActiveSheet({ data: [...activeSheet.data, ...items] });
      pushToast('success', `Imported ${items.length} row${items.length === 1 ? '' : 's'}`, file.name);
    } catch (err) {
      pushToast('error', `Couldn't import ${file.name}`, err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportAllZip = async () => {
    try {
      await generateAllZip(sheets, 'all_invoices.zip');
    } catch (err) {
      pushToast('error', "Couldn't export sheets", err instanceof Error ? err.message : String(err));
    }
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

  // Sheet name (and, since exports are named after the sheet, the exported
  // CSV/Excel filename too) should match the source PDF's filename exactly —
  // no truncation, just the extension stripped since it isn't a file on disk.
  const sheetNameFromFileName = (fileName: string): string => fileName.replace(/\.(pdf|jpe?g|png)$/i, '');

  const handleDataReady = (items: InvoiceItem[], fileName: string, mode: 'single' | 'multiple', instructionsUsed: string) => {
    const sheetName = sheetNameFromFileName(fileName);
    setSheets((prevSheets) => {
      if (mode === 'single') {
        return prevSheets.map((s) => {
          if (s.id === activeSheetId) {
            const isDefaultName = /^Sheet\d+$/.test(s.name);
            return { ...s, data: [...s.data, ...items], name: isDefaultName ? sheetName : s.name };
          }
          return s;
        });
      }
      const nextId = (Math.max(...prevSheets.map((s) => parseInt(s.id))) + 1).toString();
      const newSheet: Sheet = {
        id: nextId,
        name: sheetName,
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
                <button onClick={() => setIsPanelOpen(true)} className="menu-item"><UploadCloud size={15} className="text-[color:var(--color-ink-muted)]" /> Upload invoice…</button>
                <button onClick={() => csvInputRef.current?.click()} className="menu-item"><FileUp size={15} className="text-[color:var(--color-ink-muted)]" /> Import CSV…</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={handleExportAllZip} className="menu-item"><FolderArchive size={15} className="text-[color:var(--color-ink-muted)]" /> Export all invoices (.zip)</button>
                <button onClick={() => generateExcel(activeSheet.data, activeSheet.columns, `${activeSheet.name}.xlsx`)} className="menu-item"><FileSpreadsheet size={15} className="text-[color:var(--color-positive)]" /> Export this sheet (Excel)</button>
                <button onClick={() => generateCSV(activeSheet.data, activeSheet.columns, `${activeSheet.name}.csv`)} className="menu-item"><FileText size={15} className="text-[color:var(--color-ink-muted)]" /> Export this sheet (CSV)</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={() => downloadSOP()} className="menu-item"><BookOpen size={15} className="text-[color:var(--color-ink-muted)]" /> Download extraction logic (PDF)</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={handleClearAll} className="menu-item" style={{ color: 'var(--color-danger)' }}><Eraser size={15} /> Clear sheet</button>
              </motion.div>
            )}
          </AnimatePresence>
          <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSVFile} />
        </div>

        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'edit' ? null : 'edit'); }} className="tmenu">Edit</button>
          <AnimatePresence>
            {activeMenu === 'edit' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="menu-pop left-0">
                <button onClick={handleUndo} disabled={history.length === 0} className="menu-item"><Undo size={15} className="text-[color:var(--color-ink-muted)]" /> Undo</button>
                <button onClick={handleRedo} disabled={future.length === 0} className="menu-item"><Redo size={15} className="text-[color:var(--color-ink-muted)]" /> Redo</button>
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={handleInsertRowAbove} className="menu-item"><ArrowUpToLine size={15} className="text-[color:var(--color-ink-muted)]" /> Insert row above</button>
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
                <div className="h-px bg-[color:var(--color-line)] my-1 mx-2" />
                <button onClick={() => setIsAutomatePanelOpen(true)} className="menu-item"><Zap size={15} className="text-[color:var(--color-ink-muted)]" /> Automate…</button>
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

        <button onClick={() => setIsAutomatePanelOpen(true)} className="btn-secondary mr-2" title="Daily automation settings"><Zap size={14} /> Automate</button>
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
      <main className="flex-1 min-h-0 overflow-hidden relative">
        {isEmpty ? (
          <EmptyState onExtract={() => setIsPanelOpen(true)} onAddRow={handleAddRow} columns={activeSheet.columns} />
        ) : (
          <Spreadsheet
            data={activeSheet.data}
            columns={activeSheet.columns}
            styles={activeSheet.styles}
            visibleIndices={visibleIndices}
            isFiltered={hasActiveFilter}
            sortConfig={sortConfig}
            onSortColumn={handleSortColumn}
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
            onAddColumn={handleAddColumn}
            onRenameColumn={handleRenameColumn}
            onDeleteColumn={handleDeleteColumn}
            onResizeColumn={handleResizeColumn}
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
      <div className="h-[38px] bg-[color:var(--color-surface)] border-t border-[color:var(--color-line)] flex items-center px-2 overflow-x-auto shrink-0 select-none">
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

      <AutomatePanel
        isOpen={isAutomatePanelOpen}
        onClose={() => setIsAutomatePanelOpen(false)}
        onToast={(kind, title, detail) => pushToast(kind, title, detail)}
      />

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default App;
