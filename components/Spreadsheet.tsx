import React, { useState, useEffect, useRef } from 'react';
import { InvoiceItem, ColumnConfig, CellStyle } from '../types';
import { Plus, ArrowUp, ArrowDown, X } from 'lucide-react';

interface SpreadsheetProps {
  data: InvoiceItem[];
  columns: ColumnConfig[];
  styles: Record<string, CellStyle>;
  /** When provided, exactly these original row indices are rendered, in this order (search/type-filter and/or sort active). */
  visibleIndices?: number[];
  /** True only when a real search/type filter is narrowing rows — hides "Add row" and shows the empty-filter message. Sorting alone doesn't set this. */
  isFiltered?: boolean;
  sortConfig?: { columnId: string; direction: 'asc' | 'desc' } | null;
  onSortColumn?: (columnId: string) => void;
  onCellChange: (rowIndex: number, columnId: string, value: string) => void;
  onBatchChange?: (updates: { r: number; c: string; v: string }[]) => void;
  onSelectionChange: (rowIndex: number | null, colId: string | null) => void;
  onAddColumn?: () => void;
  onRenameColumn?: (columnId: string, newLabel: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  onResizeColumn?: (columnId: string, width: number) => void;
}

interface Coordinate {
  r: number;
  cIdx: number;
}

interface SelectionRange {
  start: Coordinate;
  end: Coordinate;
}

const DEFAULT_COL_WIDTH = 184;
const ROW_GUTTER_WIDTH = 44;
const MIN_COL_WIDTH = 80;

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
  isFiltered,
  sortConfig,
  onSortColumn,
  onCellChange,
  onBatchChange,
  onSelectionChange,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onResizeColumn,
}) => {
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [activeCell, setActiveCell] = useState<Coordinate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [renamingColId, setRenamingColId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [resizing, setResizing] = useState<{ colId: string; startX: number; startWidth: number; liveWidth: number } | null>(null);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, left: 0, scrollHeight: 0, scrollWidth: 0, clientHeight: 0, clientWidth: 0 });
  const [vDrag, setVDrag] = useState<{ startY: number; startTop: number } | null>(null);
  const [hDrag, setHDrag] = useState<{ startX: number; startLeft: number } | null>(null);

  const hasCustomOrder = visibleIndices !== undefined;
  const rowCount = Math.max(data.length, 50);
  const displayIndices = hasCustomOrder ? visibleIndices! : Array.from({ length: rowCount }, (_, i) => i);

  const colWidth = (col: ColumnConfig) => (resizing?.colId === col.id ? resizing.liveWidth : col.width ?? DEFAULT_COL_WIDTH);

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

  // Column resize drag
  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      setResizing((prev) => (prev ? { ...prev, liveWidth: Math.max(MIN_COL_WIDTH, prev.startWidth + (e.clientX - prev.startX)) } : prev));
    };
    const handleUp = () => {
      setResizing((prev) => {
        if (prev) onResizeColumn?.(prev.colId, prev.liveWidth);
        return null;
      });
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing, onResizeColumn]);

  const startResize = (col: ColumnConfig, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({ colId: col.id, startX: e.clientX, startWidth: col.width ?? DEFAULT_COL_WIDTH, liveWidth: col.width ?? DEFAULT_COL_WIDTH });
  };

  // Custom always-visible scrollbars — native ones are hidden on this
  // container because OS-level "only show while scrolling" settings (common
  // on macOS) make them disappear entirely otherwise, with no way to tell
  // there's more content below/right. Native wheel/trackpad/keyboard
  // scrolling still works as-is; this is a visible, draggable overlay
  // that mirrors it.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const update = () => setScrollMetrics({
      top: el.scrollTop, left: el.scrollLeft,
      scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight, clientWidth: el.clientWidth,
    });
    update();
    el.addEventListener('scroll', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [data, columns, displayIndices.length]);

  useEffect(() => {
    if (!vDrag) return;
    const handleMove = (e: MouseEvent) => {
      const el = scrollAreaRef.current;
      if (!el) return;
      const trackHeight = el.clientHeight;
      const ratio = el.scrollHeight / trackHeight;
      el.scrollTop = vDrag.startTop + (e.clientY - vDrag.startY) * ratio;
    };
    const handleUp = () => setVDrag(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [vDrag]);

  useEffect(() => {
    if (!hDrag) return;
    const handleMove = (e: MouseEvent) => {
      const el = scrollAreaRef.current;
      if (!el) return;
      const trackWidth = el.clientWidth;
      const ratio = el.scrollWidth / trackWidth;
      el.scrollLeft = hDrag.startLeft + (e.clientX - hDrag.startX) * ratio;
    };
    const handleUp = () => setHDrag(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [hDrag]);

  const startRename = (col: ColumnConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingColId(col.id);
    setRenameValue(col.label);
  };

  const commitRename = () => {
    if (renamingColId) {
      const trimmed = renameValue.trim();
      if (trimmed) onRenameColumn?.(renamingColId, trimmed);
    }
    setRenamingColId(null);
  };

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
      className="h-full w-full bg-[color:var(--color-surface)] flex flex-col overflow-hidden relative select-none outline-none"
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

      <div className="flex-1 min-h-0 relative overflow-hidden">
      <div ref={scrollAreaRef} className="w-full h-full overflow-auto no-scrollbar">
        <table className="border-collapse text-[13px] table-fixed" style={{ width: ROW_GUTTER_WIDTH + columns.reduce((sum, c) => sum + colWidth(c), 0) + 40 }}>
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-[color:var(--color-line-strong)]">
              <th
                className="p-0 text-center font-medium text-[10px] text-[color:var(--color-ink-muted)] border-r border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] sticky left-0 z-30"
                style={{ width: ROW_GUTTER_WIDTH }}
              ></th>
              {columns.map((col, index) => {
                const isFrozen = index === 0;
                const sortActive = sortConfig?.columnId === col.id;
                return (
                  <th
                    key={col.id}
                    className={`group/th relative px-3 pt-1.5 pb-2 text-left select-none border-r border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)]
                      ${isFrozen ? 'sticky z-30' : ''}`}
                    style={{ width: colWidth(col), ...(isFrozen ? { left: ROW_GUTTER_WIDTH } : {}) }}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-semibold text-[color:var(--color-ink-muted)] mb-0.5">{columnLetter(index)}</div>
                        {renamingColId === col.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenamingColId(null);
                            }}
                            className="w-full font-semibold text-[color:var(--color-ink)] text-[12.5px] bg-[color:var(--color-surface)] border border-[color:var(--color-brand)] rounded px-1 outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => onSortColumn?.(col.id)}
                            onDoubleClick={(e) => startRename(col, e)}
                            className="font-semibold text-[color:var(--color-ink)] text-[12.5px] truncate flex items-center gap-1 w-full text-left hover:text-[color:var(--color-brand)] transition-colors"
                            title={`${col.label} — click to sort, double-click to rename`}
                          >
                            <span className="truncate">{col.label}</span>
                            {sortActive && (sortConfig!.direction === 'asc' ? <ArrowUp size={11} className="shrink-0" /> : <ArrowDown size={11} className="shrink-0" />)}
                          </button>
                        )}
                      </div>
                      {onDeleteColumn && columns.length > 1 && renamingColId !== col.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteColumn(col.id); }}
                          className="opacity-0 group-hover/th:opacity-100 shrink-0 text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-danger)] transition-opacity"
                          title="Delete column"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    {onResizeColumn && (
                      <div
                        onMouseDown={(e) => startResize(col, e)}
                        className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize hover:bg-[color:var(--color-brand)]/40 z-10"
                      />
                    )}
                  </th>
                );
              })}
              {onAddColumn && (
                <th className="p-0 bg-[color:var(--color-surface-sunken)]" style={{ width: 40 }}>
                  <button
                    onClick={onAddColumn}
                    className="w-full h-full flex items-center justify-center text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-soft)] transition-colors"
                    title="Add column"
                  >
                    <Plus size={14} />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayIndices.map((rowIndex) => {
              const row = data[rowIndex] || {};
              const isEmpty = !hasCustomOrder && rowIndex > lastNonEmptyRowIdx;
              if (isEmpty && rowIndex > lastNonEmptyRowIdx + 15) return null;

              const rowSelected =
                selectionRange &&
                rowIndex >= Math.min(selectionRange.start.r, selectionRange.end.r) &&
                rowIndex <= Math.max(selectionRange.start.r, selectionRange.end.r);

              return (
                <tr key={rowIndex} className={`h-[38px] group/row transition-colors ${rowSelected ? '' : 'hover:bg-[color:var(--color-surface-sunken)]/60'} ${!isEmpty ? 'border-b border-[color:var(--color-line)]' : ''}`}>
                  <td
                    className={`text-center text-[11px] font-medium transition-colors select-none sticky left-0 z-20 border-r border-[color:var(--color-line)]
                      ${rowSelected ? 'text-[color:var(--color-brand)] font-bold bg-[color:var(--color-brand-soft)]' : 'text-[color:var(--color-ink-muted)] bg-[color:var(--color-surface-sunken)]'}`}
                    style={{ width: ROW_GUTTER_WIDTH }}
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
                    const isFrozen = colIndex === 0;

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

                    const frozenBg = isActive ? '' : isSelected ? 'bg-[color:var(--color-brand-soft)]' : 'bg-[color:var(--color-surface)]';

                    return (
                      <td
                        key={colIndex}
                        className={`p-0 relative transition-all duration-75 border-r border-[color:var(--color-line)]
                          ${isFrozen ? `sticky z-10 ${frozenBg}` : ''}
                          ${isActive ? 'z-30 ring-2 ring-[color:var(--color-brand)] ring-inset bg-[color:var(--color-surface)]' : ''}
                          ${isSelected && !isActive && !isFrozen ? 'bg-[color:var(--color-brand-soft)]' : ''}
                        `}
                        style={{ width: colWidth(col), ...(isFrozen ? { left: ROW_GUTTER_WIDTH } : {}) }}
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
                  {onAddColumn && <td className="bg-[color:var(--color-surface)]" style={{ width: 40 }} />}
                </tr>
              );
            })}

            {!isFiltered && (
              <tr>
                <td colSpan={columns.length + (onAddColumn ? 2 : 1)} className="py-6">
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

      {/* Custom always-visible scrollbars — see the note above the tracking effect */}
      {scrollMetrics.scrollHeight > scrollMetrics.clientHeight && (
        <div className="absolute top-0 right-0 bottom-0 w-[12px] z-40">
          <div
            onMouseDown={(e) => { e.preventDefault(); setVDrag({ startY: e.clientY, startTop: scrollMetrics.top }); }}
            className="absolute right-[2px] w-[8px] rounded-full bg-[color:var(--color-line-strong)] hover:bg-[color:var(--color-ink-muted)] active:bg-[color:var(--color-ink-muted)] cursor-pointer transition-colors"
            style={{
              top: `${Math.min(
                (scrollMetrics.top / scrollMetrics.scrollHeight) * scrollMetrics.clientHeight,
                scrollMetrics.clientHeight - Math.max(24, (scrollMetrics.clientHeight / scrollMetrics.scrollHeight) * scrollMetrics.clientHeight)
              )}px`,
              height: `${Math.max(24, (scrollMetrics.clientHeight / scrollMetrics.scrollHeight) * scrollMetrics.clientHeight)}px`,
            }}
          />
        </div>
      )}
      {scrollMetrics.scrollWidth > scrollMetrics.clientWidth && (
        <div className="absolute bottom-0 left-0 right-[12px] h-[12px] z-40">
          <div
            onMouseDown={(e) => { e.preventDefault(); setHDrag({ startX: e.clientX, startLeft: scrollMetrics.left }); }}
            className="absolute bottom-[2px] h-[8px] rounded-full bg-[color:var(--color-line-strong)] hover:bg-[color:var(--color-ink-muted)] active:bg-[color:var(--color-ink-muted)] cursor-pointer transition-colors"
            style={{
              left: `${Math.min(
                (scrollMetrics.left / scrollMetrics.scrollWidth) * scrollMetrics.clientWidth,
                scrollMetrics.clientWidth - Math.max(24, (scrollMetrics.clientWidth / scrollMetrics.scrollWidth) * scrollMetrics.clientWidth)
              )}px`,
              width: `${Math.max(24, (scrollMetrics.clientWidth / scrollMetrics.scrollWidth) * scrollMetrics.clientWidth)}px`,
            }}
          />
        </div>
      )}
      </div>
    </div>
  );
};
