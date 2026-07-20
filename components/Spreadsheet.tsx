import React, { useState, useEffect, useRef } from 'react';
import { InvoiceItem, ColumnConfig, CellStyle } from '../types';
import { Plus, Type, Hash, Calendar } from 'lucide-react';

interface SpreadsheetProps {
  data: InvoiceItem[];
  columns: ColumnConfig[];
  styles: Record<string, CellStyle>;
  onCellChange: (rowIndex: number, columnId: string, value: string) => void;
  onBatchChange?: (updates: { r: number; c: string; v: string }[]) => void;
  onColumnUpdate: (newColumns: ColumnConfig[]) => void;
  onSelectionChange: (rowIndex: number | null, colId: string | null) => void;
}

interface Coordinate {
  r: number;
  cIdx: number;
}

interface SelectionRange {
  start: Coordinate;
  end: Coordinate;
}

const columnLetter = (index: number): string => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

export const Spreadsheet: React.FC<SpreadsheetProps> = ({
  data,
  columns,
  styles,
  onCellChange,
  onBatchChange,
  onColumnUpdate,
  onSelectionChange,
}) => {
  const [newColumnName, setNewColumnName] = useState('');
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [activeCell, setActiveCell] = useState<Coordinate | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const gridContainerRef = useRef<HTMLDivElement>(null);

  const rowCount = Math.max(data.length, 50);
  const rows = Array.from({ length: rowCount }, (_, i) => data[i] || {});

  const handleAddColumn = () => {
    if (newColumnName.trim()) {
      onColumnUpdate([...columns, { id: newColumnName, label: newColumnName, type: 'string', required: false }]);
      setNewColumnName('');
    }
  };

  const handleRemoveColumn = (id: string) => {
    onColumnUpdate(columns.filter((c) => c.id !== id));
  };

  const cycleColumnType = (id: string) => {
    const types: ('string' | 'number' | 'date')[] = ['string', 'number', 'date'];
    const updated = columns.map((c) => {
      if (c.id === id) {
        const nextIndex = (types.indexOf(c.type) + 1) % types.length;
        return { ...c, type: types[nextIndex] };
      }
      return c;
    });
    onColumnUpdate(updated);
  };

  const handleMouseDown = (rowIndex: number, colIndex: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectionRange) {
      setSelectionRange({ ...selectionRange, end: { r: rowIndex, cIdx: colIndex } });
    } else {
      const newCoord = { r: rowIndex, cIdx: colIndex };
      setActiveCell(newCoord);
      setSelectionRange({ start: newCoord, end: newCoord });
      setIsDragging(true);
      onSelectionChange(rowIndex, columns[colIndex]?.id || null);
    }
  };

  const handleMouseEnter = (rowIndex: number, colIndex: number) => {
    if (isDragging && selectionRange) {
      setSelectionRange({ ...selectionRange, end: { r: rowIndex, cIdx: colIndex } });
    }
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isDragging) setIsDragging(false);
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [isDragging]);

  const handleRowHeaderClick = (rowIndex: number) => {
    const start = { r: rowIndex, cIdx: 0 };
    const end = { r: rowIndex, cIdx: columns.length - 1 };
    setSelectionRange({ start, end });
    setActiveCell(start);
    onSelectionChange(rowIndex, null);
    gridContainerRef.current?.focus();
  };

  const isInRange = (rowIndex: number, colIndex: number) => {
    if (!selectionRange) return false;
    const minR = Math.min(selectionRange.start.r, selectionRange.end.r);
    const maxR = Math.max(selectionRange.start.r, selectionRange.end.r);
    const minC = Math.min(selectionRange.start.cIdx, selectionRange.end.cIdx);
    const maxC = Math.max(selectionRange.start.cIdx, selectionRange.end.cIdx);
    return rowIndex >= minR && rowIndex <= maxR && colIndex >= minC && colIndex <= maxC;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isInputFocused = (e.target as HTMLElement).tagName === 'INPUT';

    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      setSelectionRange({ start: { r: 0, cIdx: 0 }, end: { r: rowCount - 1, cIdx: columns.length - 1 } });
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isInputFocused && (e.target as HTMLInputElement).value !== '') return;

      if (selectionRange && onBatchChange) {
        e.preventDefault();
        const updates: { r: number; c: string; v: string }[] = [];
        const minR = Math.min(selectionRange.start.r, selectionRange.end.r);
        const maxR = Math.max(selectionRange.start.r, selectionRange.end.r);
        const minC = Math.min(selectionRange.start.cIdx, selectionRange.end.cIdx);
        const maxC = Math.max(selectionRange.start.cIdx, selectionRange.end.cIdx);

        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            const col = columns[c];
            if (col) updates.push({ r, c: col.label, v: '' });
          }
        }
        if (updates.length > 0) onBatchChange(updates);
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (isInputFocused && window.getSelection()?.toString()) return;

      if (selectionRange) {
        e.preventDefault();
        const minR = Math.min(selectionRange.start.r, selectionRange.end.r);
        const maxR = Math.max(selectionRange.start.r, selectionRange.end.r);
        const minC = Math.min(selectionRange.start.cIdx, selectionRange.end.cIdx);
        const maxC = Math.max(selectionRange.start.cIdx, selectionRange.end.cIdx);

        const rowsStr: string[] = [];
        for (let r = minR; r <= maxR; r++) {
          const rowCells: string[] = [];
          for (let c = minC; c <= maxC; c++) {
            const col = columns[c];
            const val = data[r]?.[col.label] || '';
            rowCells.push(String(val));
          }
          rowsStr.push(rowCells.join('\t'));
        }
        navigator.clipboard.writeText(rowsStr.join('\n')).catch((err) => console.error(err));
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const isInputFocused = (e.target as HTMLElement).tagName === 'INPUT';
    const text = e.clipboardData.getData('text');
    if (!text || !onBatchChange) return;

    const pastedRows = text.split(/\r\n|\n|\r/);
    const isMultiLine = pastedRows.length > 1;
    const isTabular = pastedRows[0].includes('\t');

    if (!isMultiLine && !isTabular && isInputFocused) return;

    e.preventDefault();

    let startR = 0;
    let startCIdx = 0;

    if (activeCell) {
      startR = activeCell.r;
      startCIdx = activeCell.cIdx;
    } else if (selectionRange) {
      startR = Math.min(selectionRange.start.r, selectionRange.end.r);
      startCIdx = Math.min(selectionRange.start.cIdx, selectionRange.end.cIdx);
    } else {
      return;
    }

    const updates: { r: number; c: string; v: string }[] = [];

    pastedRows.forEach((rowStr, rOffset) => {
      if (!rowStr && rOffset === pastedRows.length - 1) return;
      const cells = rowStr.split('\t');
      cells.forEach((val, cOffset) => {
        const targetCol = columns[startCIdx + cOffset];
        if (targetCol) updates.push({ r: startR + rOffset, c: targetCol.label, v: val.trim() });
      });
    });

    if (updates.length > 0) onBatchChange(updates);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('table')) return;
      if ((e.target as HTMLElement).closest('.toolbar-control')) return;
      setSelectionRange(null);
      setActiveCell(null);
      onSelectionChange(null, null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onSelectionChange]);

  const lastNonEmptyRowIdx = data.reduce((acc, row, idx) => (Object.values(row).some((v) => v !== '') ? idx : acc), -1);

  return (
    <div
      ref={gridContainerRef}
      className="flex-1 bg-white flex flex-col overflow-hidden relative select-none outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    >
      <div className="flex-1 overflow-auto no-scrollbar">
        <table className="w-full border-collapse text-[13px] table-fixed">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-slate-200">
              <th className="w-[44px] bg-slate-50 p-0 text-center font-medium text-[10px] text-slate-400 border-r border-slate-200"></th>
              {columns.map((col, index) => (
                <th
                  key={col.id}
                  className="px-3 pt-1.5 pb-2 text-left w-[184px] bg-slate-50 select-none relative group border-r border-slate-200"
                >
                  <div className="text-[9px] font-medium text-slate-400 mb-0.5">{columnLetter(index)}</div>
                  <div className="flex items-center gap-2 pr-5">
                    <span className="font-semibold text-slate-700 text-[12.5px] truncate" title={col.label}>{col.label}</span>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-50">
                      <button
                        onClick={() => cycleColumnType(col.id)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-500"
                        title={`Type: ${col.type}`}
                      >
                        {col.type === 'string' && <Type size={11} />}
                        {col.type === 'number' && <Hash size={11} />}
                        {col.type === 'date' && <Calendar size={11} />}
                      </button>
                    </div>
                  </div>
                </th>
              ))}
              <th className="bg-slate-50 w-[120px] border-r border-slate-200">
                <div className="flex items-center gap-1 px-2 toolbar-control">
                  <input
                    type="text"
                    placeholder="+ column"
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
                    className="w-20 bg-transparent text-[11px] font-normal text-slate-400 placeholder:text-slate-400 outline-none"
                  />
                  {newColumnName && (
                    <button onClick={handleAddColumn} className="text-brand shrink-0">
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {rows.map((row, rowIndex) => {
              const isEmpty = rowIndex > lastNonEmptyRowIdx;
              if (isEmpty && rowIndex > lastNonEmptyRowIdx + 15) return null;

              return (
                <tr key={rowIndex} className={`h-[38px] hover:bg-slate-50/70 group/row ${!isEmpty ? 'border-b border-slate-100' : ''}`}>
                  <td
                    className={`text-center text-[11px] font-medium transition-colors w-[44px] select-none sticky left-0 z-10 bg-slate-50 border-r border-slate-200
                      ${
                        selectionRange &&
                        rowIndex >= Math.min(selectionRange.start.r, selectionRange.end.r) &&
                        rowIndex <= Math.max(selectionRange.start.r, selectionRange.end.r)
                          ? 'text-brand font-bold'
                          : 'text-slate-400'
                      }
                    `}
                    onClick={() => handleRowHeaderClick(rowIndex)}
                  >
                    {!isEmpty || rowIndex === lastNonEmptyRowIdx + 1 ? rowIndex + 1 : ''}
                  </td>

                  {columns.map((col, colIndex) => {
                    const rawValue = (row[col.label] as string) || '';
                    let cellValue = rawValue;

                    if (col.label.toUpperCase() === 'SERIAL #' && !cellValue) {
                      cellValue = '-';
                    }

                    const isPrice = col.label.toUpperCase() === 'PURCHASE PRICE';
                    const isStatus = col.label.toUpperCase() === 'STATUS';
                    const isIdType = ['PO #', 'MODEL #', 'SERIAL #'].includes(col.label.toUpperCase()) || col.type === 'number' || col.type === 'date';

                    const isSelected = isInRange(rowIndex, colIndex);
                    const isActive = activeCell?.r === rowIndex && activeCell?.cIdx === colIndex;

                    let displayValue = cellValue;
                    if (isPrice && cellValue && !isNaN(parseFloat(cellValue))) {
                      displayValue = new Intl.NumberFormat('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(parseFloat(cellValue));
                    }

                    return (
                      <td
                        key={colIndex}
                        className={`p-0 relative transition-all duration-75 border-r border-slate-100
                          ${isActive ? 'z-30 ring-2 ring-brand ring-inset bg-white' : ''}
                          ${isSelected && !isActive ? 'bg-blue-50' : ''}
                        `}
                        onMouseDown={(e) => handleMouseDown(rowIndex, colIndex, e)}
                        onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                      >
                        {isStatus && cellValue.toUpperCase() === 'ORDERED' ? (
                          <div className="px-3 h-full flex items-center">
                            <span className="status-pill">Ordered</span>
                          </div>
                        ) : (
                          <input
                            type="text"
                            className={`w-full h-full px-3 bg-transparent outline-none border-none text-slate-900
                              ${isIdType || isPrice ? 'numerical text-[12.5px]' : 'text-[13px] font-normal'}
                              ${isPrice ? 'text-right' : 'text-left'}
                            `}
                            style={{ color: col.label.toUpperCase() === 'SERIAL #' && !rawValue ? '#CBD5E1' : undefined }}
                            value={isActive ? rawValue : displayValue}
                            onFocus={() => {
                              setActiveCell({ r: rowIndex, cIdx: colIndex });
                              if (!selectionRange) setSelectionRange({ start: { r: rowIndex, cIdx: colIndex }, end: { r: rowIndex, cIdx: colIndex } });
                              onSelectionChange(rowIndex, col.id);
                            }}
                            onChange={(e) => onCellChange(rowIndex, col.label, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td></td>
                </tr>
              );
            })}

            <tr>
              <td colSpan={columns.length + 2} className="py-6">
                <button
                  onClick={() => onCellChange(lastNonEmptyRowIdx + 1, columns[0].label, '')}
                  className="w-full text-center text-slate-400 text-[12px] font-medium hover:text-brand transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus size={13} /> Add row
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
