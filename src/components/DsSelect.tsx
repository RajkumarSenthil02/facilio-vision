import { useEffect, useId, useRef, useState } from 'react';

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
 * Facilio Atom select — standing rule: never native browser controls.
 * Button + popover listbox with keyboard support (arrows/enter/escape).
 */
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
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(options.findIndex((o) => o.value === value));
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
        else setOpen(true);
        break;
      case 'Escape':
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
    }
  };

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
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'ds-select-value' : 'ds-select-value placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="ds-select-pop" role="listbox" id={listId} aria-label={label}>
          {options.length === 0 && <li className="ds-select-empty">No options</li>}
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={
                'ds-select-opt' +
                (option.value === value ? ' selected' : '') +
                (index === activeIndex ? ' active' : '')
              }
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
