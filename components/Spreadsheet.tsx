import React, { useState, useEffect, useRef } from 'react';
import { InvoiceItem, ColumnConfig, CellStyle } from '../types';
import { Plus } from 'lucide-react';

interface SpreadsheetProps {
  data: InvoiceItem[];
  columns: ColumnConfig[];
  styles: Record<string, CellStyle>;
  /** When provided, only these original row indices are rendered (search/type-filter active). */
  visibleIndices?: number[];
  onCellChange: (rowIndex: number, columnId: string, value: string) => void;
  onBatchChange?: (updates: { r: number; c: string; v: string }[]) => void;
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
  visibleIndices,
  onCellChange,
  onBatchChange,
  onSelectionChange,
}) => {
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [activeCell, setActiveCell] = useState<Coordinate | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const gridContainerRef = useRef<HTMLDivElement>(null);

  const isFiltered = visibleIndices !== undefined;
  const rowCount = Math.max(data.length, 50);
  const displayIndices = isFiltered ? visibleIndices! : Array.from({ length: rowCount }, (_, i) => i);

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

  const activeCol = activeCell ? columns[activeCell.cIdx] : null;
  const activeCellRef = activeCell ? `${columnLetter(activeCell.cIdx)}${activeCell.r + 1}` : '';
  const activeCellValue = activeCell && activeCol ? String(data[activeCell.r]?.[activeCol.label] ?? '') : '';

  return (
    <div
      ref={gridContainerRef}
      className="flex-1 bg-[color:var(--color-surface)] flex flex-col overflow-hidden relative select-none outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    >
      {/* Name box + formula readout */}
      <div className="h-8 flex items-center shrink-0 border-b border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
        <div className="w-24 h-full flex items-center px-3 border-r border-[color:var(--color-line)] numerical text-[12px] font-semibold text-[color:var(--color-ink)]">
          {activeCellRef}
        </div>
        <div className="w-9 h-full flex items-center justify-center border-r border-[color:var(--color-line)] italic text-[13px] text-[color:var(--color-ink-muted)]" style={{ fontFamily: 'Georgia, serif' }}>
          fx
        </div>
        <div className="px-3 text-[12.5px] text-[color:var(--color-ink)] truncate flex-1">{activeCellValue}</div>
      </div>

      <div className="flex-1 overflow-auto no-scrollbar">
        <table className="w-full border-collapse text-[13px] table-fixed">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-[color:var(--color-line-strong)]">
              <th className="w-[44px] p-0 text-center font-medium text-[10px] text-[color:var(--color-ink-muted)] border-r border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)]"></th>
              {columns.map((col, index) => (
                <th
                  key={col.id}
                  className="px-3 pt-1.5 pb-2 text-left w-[184px] select-none border-r border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)]"
                >
                  <div className="text-[9px] font-semibold text-[color:var(--color-ink-muted)] mb-0.5">{columnLetter(index)}</div>
                  <span className="font-semibold text-[color:var(--color-ink)] text-[12.5px] truncate block" title={col.label}>{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayIndices.map((rowIndex) => {
              const row = data[rowIndex] || {};
              const isEmpty = !isFiltered && rowIndex > lastNonEmptyRowIdx;
              if (isEmpty && rowIndex > lastNonEmptyRowIdx + 15) return null;

              const rowSelected =
                selectionRange &&
                rowIndex >= Math.min(selectionRange.start.r, selectionRange.end.r) &&
                rowIndex <= Math.max(selectionRange.start.r, selectionRange.end.r);

              return (
                <tr key={rowIndex} className={`h-[38px] group/row transition-colors ${rowSelected ? '' : 'hover:bg-[color:var(--color-surface-sunken)]/60'} ${!isEmpty ? 'border-b border-[color:var(--color-line)]' : ''}`}>
                  <td
                    className={`text-center text-[11px] font-medium transition-colors w-[44px] select-none sticky left-0 z-10 border-r border-[color:var(--color-line)]
                      ${rowSelected ? 'text-[color:var(--color-brand)] font-bold bg-[color:var(--color-brand-soft)]' : 'text-[color:var(--color-ink-muted)] bg-[color:var(--color-surface-sunken)]'}`}
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
                    const isItemType = col.label.toUpperCase() === 'ITEM TYPE';
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

                    const badgeClass = (v: string) => {
                      switch (v.toUpperCase()) {
                        case 'ASSET': return 'badge badge-asset';
                        case 'BULK ITEM': return 'badge badge-bulk';
                        case 'PREPAID': return 'badge badge-prepaid';
                        case 'LABOUR': return 'badge badge-labour';
                        case 'SHIPPING': return 'badge badge-shipping';
                        default: return 'badge badge-unknown';
                      }
                    };

                    return (
                      <td
                        key={colIndex}
                        className={`p-0 relative transition-all duration-75 border-r border-[color:var(--color-line)]
                          ${isActive ? 'z-30 ring-2 ring-[color:var(--color-brand)] ring-inset bg-[color:var(--color-surface)]' : ''}
                          ${isSelected && !isActive ? 'bg-[color:var(--color-brand-soft)]' : ''}
                        `}
                        onMouseDown={(e) => handleMouseDown(rowIndex, colIndex, e)}
                        onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                      >
                        {isStatus && cellValue.toUpperCase() === 'ORDERED' && !isActive ? (
                          <div className="px-3 h-full flex items-center" onDoubleClick={() => setActiveCell({ r: rowIndex, cIdx: colIndex })}>
                            <span className="status-dot"><span className="dot" />Ordered</span>
                          </div>
                        ) : isItemType && cellValue && !isActive ? (
                          <div className="px-3 h-full flex items-center" onDoubleClick={() => setActiveCell({ r: rowIndex, cIdx: colIndex })}>
                            <span className={badgeClass(cellValue)}>{cellValue}</span>
                          </div>
                        ) : (
                          <input
                            type="text"
                            className={`w-full h-full px-3 bg-transparent outline-none border-none text-[color:var(--color-ink)]
                              ${isIdType || isPrice ? 'numerical text-[12.5px]' : 'text-[13px] font-normal'}
                              ${isPrice ? 'text-right' : 'text-left'}
                            `}
                            style={{ color: col.label.toUpperCase() === 'SERIAL #' && !rawValue ? 'var(--color-ink-muted)' : undefined }}
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
                </tr>
              );
            })}

            {!isFiltered && (
              <tr>
                <td colSpan={columns.length + 1} className="py-6">
                  <button
                    onClick={() => onCellChange(lastNonEmptyRowIdx + 1, columns[0].label, '')}
                    className="w-full text-center text-[color:var(--color-ink-muted)] text-[12px] font-medium hover:text-[color:var(--color-brand)] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus size={13} /> Add row
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {isFiltered && displayIndices.length === 0 && (
          <div className="py-16 text-center text-[13px] text-[color:var(--color-ink-muted)]">No rows match this filter.</div>
        )}
      </div>
    </div>
  );
};
