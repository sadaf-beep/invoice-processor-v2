import React, { useState, useEffect } from 'react';
import {
  Sparkles, Grid3X3, Plus, X, Undo, Redo, Bold, Italic,
  AlignLeft, AlignCenter, AlignRight, Trash2, ChevronDown, Download,
  Eraser, BookOpen, FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadSOP } from './lib/sopGenerator';
import { ExtractPanel } from './components/ExtractPanel';
import { Spreadsheet } from './components/Spreadsheet';
import { InvoiceItem, ColumnConfig, DEFAULT_COLUMNS, Sheet, DEFAULT_INSTRUCTIONS, CellStyle } from './types';
import { generateExcel, generateCSV } from './services/excelService';

interface HistoryState {
  data: InvoiceItem[];
  styles: Record<string, CellStyle>;
  columns: ColumnConfig[];
}

const App: React.FC = () => {
  const [sheets, setSheets] = useState<Sheet[]>([
    { id: '1', name: 'Sheet1', data: [], columns: DEFAULT_COLUMNS, customInstructions: DEFAULT_INSTRUCTIONS, styles: {} },
  ]);
  const [activeSheetId, setActiveSheetId] = useState<string>('1');
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const [selectedCell, setSelectedCell] = useState<{ r: number; c: string } | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'export' | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [tempTabName, setTempTabName] = useState('');

  const [history, setHistory] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

  const activeSheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];

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
  };

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null);
    if (activeMenu) window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenu]);

  return (
    <div className="h-screen w-screen flex flex-col bg-white font-sans overflow-hidden">
      {/* Top bar */}
      <div className="h-[52px] bg-white border-b border-slate-200 flex items-center px-4 gap-1 shrink-0">
        <div className="flex items-center gap-2 mr-4 shrink-0">
          <div className="bg-brand w-6 h-6 rounded-md flex items-center justify-center">
            <Grid3X3 className="text-white" size={14} />
          </div>
          <span className="font-bold text-[14px] text-slate-800 tracking-tight hidden sm:inline">InvoiceIntel</span>
        </div>

        {/* File menu */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'file' ? null : 'file'); }}
            className="px-2.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-md"
          >
            File
          </button>
          <AnimatePresence>
            {activeMenu === 'file' && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                className="absolute top-full left-0 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 text-sm z-50"
              >
                <button onClick={() => downloadSOP()} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2.5 text-slate-600">
                  <BookOpen size={15} className="text-slate-400" /> Download logic (PDF)
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={handleClearAll} className="w-full text-left px-3.5 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2.5 font-medium">
                  <Eraser size={15} /> Clear sheet
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Edit menu */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'edit' ? null : 'edit'); }}
            className="px-2.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-md"
          >
            Edit
          </button>
          <AnimatePresence>
            {activeMenu === 'edit' && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                className="absolute top-full left-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 text-sm z-50"
              >
                <button onClick={handleUndo} disabled={history.length === 0} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex justify-between items-center disabled:opacity-30">
                  <span className="flex items-center gap-2.5 text-slate-600"><Undo size={15} className="text-slate-400" /> Undo</span>
                </button>
                <button onClick={handleRedo} disabled={future.length === 0} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex justify-between items-center disabled:opacity-30">
                  <span className="flex items-center gap-2.5 text-slate-600"><Redo size={15} className="text-slate-400" /> Redo</span>
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={handleDeleteRow} disabled={selectedRowIndex === null} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 disabled:opacity-30 flex items-center gap-2.5 text-slate-600">
                  <Trash2 size={15} className="text-slate-400" /> Delete row
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Quick undo/redo icons */}
        <button onClick={handleUndo} disabled={history.length === 0} className="toolbar-btn disabled:opacity-30 text-slate-500"><Undo size={16} /></button>
        <button onClick={handleRedo} disabled={future.length === 0} className="toolbar-btn disabled:opacity-30 text-slate-500"><Redo size={16} /></button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Formatting */}
        <button onClick={() => applyStyle({ bold: true })} className="toolbar-btn text-slate-500"><Bold size={16} /></button>
        <button onClick={() => applyStyle({ italic: true })} className="toolbar-btn text-slate-500"><Italic size={16} /></button>
        <button onClick={() => applyStyle({ align: 'left' })} className="toolbar-btn text-slate-500"><AlignLeft size={16} /></button>
        <button onClick={() => applyStyle({ align: 'center' })} className="toolbar-btn text-slate-500"><AlignCenter size={16} /></button>
        <button onClick={() => applyStyle({ align: 'right' })} className="toolbar-btn text-slate-500"><AlignRight size={16} /></button>

        <div className="flex-1" />

        {/* Export */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'export' ? null : 'export'); }}
            className="h-[32px] px-3 border border-slate-200 text-slate-600 text-[12.5px] font-medium rounded-md hover:bg-slate-50 flex items-center gap-1.5 mr-2"
          >
            <Download size={14} /> Export <ChevronDown size={12} />
          </button>
          <AnimatePresence>
            {activeMenu === 'export' && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                className="absolute top-full right-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 text-sm z-50"
              >
                <button onClick={() => generateExcel(activeSheet.data, activeSheet.columns, `${activeSheet.name}.xlsx`)} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2.5 text-slate-600">
                  <FileText size={15} className="text-slate-400" /> Export to Excel
                </button>
                <button onClick={() => generateCSV(activeSheet.data, activeSheet.columns, `${activeSheet.name}.csv`)} className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2.5 text-slate-600">
                  <FileText size={15} className="text-slate-400" /> Export to CSV
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={handleAddRow} className="h-[32px] px-3 border border-slate-200 text-slate-600 text-[12.5px] font-medium rounded-md hover:bg-slate-50 flex items-center gap-1.5 mr-2">
          <Plus size={14} /> Row
        </button>

        <button
          onClick={() => setIsPanelOpen(true)}
          className="h-[32px] px-3.5 bg-brand text-white text-[12.5px] font-semibold rounded-md hover:bg-brand-hover flex items-center gap-1.5 shadow-sm"
        >
          <Sparkles size={14} /> Extract Data
        </button>
      </div>

      {/* Main grid */}
      <main className="flex-1 overflow-hidden relative">
        <Spreadsheet
          data={activeSheet.data}
          columns={activeSheet.columns}
          styles={activeSheet.styles}
          onCellChange={(r, c, v) => {
            const newData = [...activeSheet.data];
            if (!newData[r]) newData[r] = {};
            newData[r] = { ...newData[r], [c]: v };
            updateActiveSheet({ data: newData });
          }}
          onBatchChange={handleBatchChange}
          onColumnUpdate={(cols) => updateActiveSheet({ columns: cols })}
          onSelectionChange={(r, c) => {
            setSelectedRowIndex(r);
            setSelectedCell(c && r !== null ? { r, c } : null);
          }}
        />
      </main>

      {/* Sheet tabs */}
      <div className="h-[38px] bg-slate-50 border-t border-slate-200 flex items-center px-3 overflow-x-auto no-scrollbar shrink-0 select-none">
        <button
          onClick={() => {
            const newId = Date.now().toString();
            const newSheet: Sheet = { id: newId, name: `Sheet${sheets.length + 1}`, data: [{}], columns: [...DEFAULT_COLUMNS], customInstructions: DEFAULT_INSTRUCTIONS, styles: {} };
            setSheets([...sheets, newSheet]);
            setActiveSheetId(newId);
          }}
          className="p-1.5 mr-2 text-slate-400 hover:text-brand transition-colors"
          title="Add sheet"
        >
          <Plus size={15} />
        </button>

        {sheets.map((sheet) => (
          <div
            key={sheet.id}
            onClick={() => setActiveSheetId(sheet.id)}
            onDoubleClick={() => { setEditingTabId(sheet.id); setTempTabName(sheet.name); }}
            className={`group relative flex items-center gap-2 px-3.5 h-full text-[12.5px] cursor-pointer border-r border-slate-200
              ${activeSheetId === sheet.id ? 'text-slate-900 font-semibold bg-white' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {activeSheetId === sheet.id && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
            {editingTabId === sheet.id ? (
              <input
                autoFocus
                type="text"
                className="bg-transparent outline-none w-full border-b border-brand"
                value={tempTabName}
                onChange={(e) => setTempTabName(e.target.value)}
                onBlur={() => { updateActiveSheet({ name: tempTabName || sheet.name }, false); setEditingTabId(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { updateActiveSheet({ name: tempTabName || sheet.name }, false); setEditingTabId(null); } }}
              />
            ) : (
              <>
                <span className="truncate">{sheet.name}</span>
                {sheets.length > 1 && (
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
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
        activeSheet={activeSheet}
      />
    </div>
  );
};

export default App;
