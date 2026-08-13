import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

export interface DsOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: DsOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange(value: string): void;
}

/**
 * Facilio DSM select — never a native <select> (standing rule).
 *
 * Two presentations, because one does not fit both:
 *  - TOUCH / narrow: a bottom action sheet. A floating popover attached to a
 *    control that already sits inside a sheet has nowhere to go — it flips up,
 *    covers the very context you are choosing for, and reads as a detached
 *    slab. An action sheet is what a native app does, and it cannot be clipped
 *    by any ancestor.
 *  - POINTER / wide: an anchored popover, position:fixed so no ancestor
 *    scroller can clip it.
 */
function useCoarsePointer(): boolean {
  const query = '(pointer: coarse), (max-width: 767px)';
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

export default function DsSelect({
  label,
  value,
  options,
  placeholder = 'Select…',
  disabled,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const coarse = useCoarsePointer();

  const selected = options.find((o) => o.value === value);

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const height = Math.min(options.length * 44 + 8, 280);
    // Below when there is room, otherwise above — but never off-screen.
    const top = room >= height ? r.bottom + 6 : Math.max(8, r.top - 6 - height);
    setRect({ left: r.left, top, width: Math.max(r.width, 200) });
  };

  useEffect(() => {
    if (!open || coarse) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target) || target.closest?.('.ds-select-pop')) return;
      setOpen(false);
    };
    const reflow = () => measure();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open, coarse]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(options.findIndex((o) => o.value === value));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, options, value]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open && activeIndex >= 0) commit(activeIndex);
        else {
          measure();
          setOpen(true);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          measure();
          setOpen(true);
        } else setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
    }
  };

  const optionRows = options.map((option, index) => (
    <li
      key={option.value}
      role="option"
      aria-selected={option.value === value}
      className={
        'ds-select-opt' +
        (option.value === value ? ' selected' : '') +
        (index === activeIndex && !coarse ? ' active' : '')
      }
      onPointerEnter={coarse ? undefined : () => setActiveIndex(index)}
      onClick={() => commit(index)}
    >
      <span className="ds-select-opt-label">{option.label}</span>
      {option.value === value && <Icon name="check" size={18} className="ds-select-tick" />}
    </li>
  ));

  return (
    <div className="ds-select" ref={rootRef}>
      <span className="ds-select-label">{label}</span>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        className={open ? 'ds-select-btn open' : 'ds-select-btn'}
        disabled={disabled}
        ref={btnRef}
        onClick={() => {
          measure();
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'ds-select-value' : 'ds-select-value placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevron-down" size={16} className="ds-select-caret" />
      </button>

      {open && coarse && (
        <div className="ds-sheet-root" role="dialog" aria-modal="true" aria-label={label}>
          <button className="ds-sheet-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="ds-sheet-panel">
            <div className="ds-sheet-grip" aria-hidden="true" />
            <p className="ds-sheet-title">{label}</p>
            <ul className="ds-sheet-list scroll-y" role="listbox" id={listId} aria-label={label}>
              {options.length === 0 && <li className="ds-select-empty">No options</li>}
              {optionRows}
            </ul>
          </div>
        </div>
      )}

      {open && !coarse && (
        <ul
          className="ds-select-pop"
          role="listbox"
          id={listId}
          aria-label={label}
          style={rect ? { left: rect.left, top: rect.top, width: rect.width } : undefined}
        >
          {options.length === 0 && <li className="ds-select-empty">No options</li>}
          {optionRows}
        </ul>
      )}
    </div>
  );
}
