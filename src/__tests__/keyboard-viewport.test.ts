// The keyboard contract: --app-h tracks the VISIBLE area, kb-open flags a
// keyboard, and full-screen surfaces are sized by --app-h (never `bottom: 0`,
// which anchors to the layout viewport the keyboard does not shrink).
// This is the fix for "the dock rides up over the form and buttons hide".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installViewportHeight } from '../shell/viewportHeight';

type Listener = () => void;

function fakeVisualViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, Listener[]> = {};
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: () => undefined,
    fire(type: string) {
      for (const fn of listeners[type] ?? []) fn();
    },
    set(h: number, top = 0) {
      vv.height = h;
      vv.offsetTop = top;
      vv.fire('resize');
    },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  return vv;
}

afterEach(() => {
  document.documentElement.classList.remove('kb-open');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe('keyboard-aware viewport', () => {
  it('kb-open toggles with the keyboard and --app-h follows the visible area', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const vv = fakeVisualViewport(844);
    installViewportHeight();

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--app-h')).toBe('844px');
    expect(root.classList.contains('kb-open')).toBe(false);

    vv.set(508); // keyboard up: 844 - 508 = 336px of keys
    expect(root.style.getPropertyValue('--app-h')).toBe('508px');
    expect(root.classList.contains('kb-open')).toBe(true);

    vv.set(790); // browser chrome settling is NOT a keyboard
    expect(root.classList.contains('kb-open')).toBe(false);
  });

  it('mirrors the iOS pan offset into --vv-top so the app can be glued back', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const vv = fakeVisualViewport(844);
    installViewportHeight();

    vv.set(508, 60); // iOS panned the page 60px to reveal the input
    expect(document.documentElement.style.getPropertyValue('--vv-top')).toBe('60px');
  });

  it('no full-screen surface is anchored with bottom: 0 or inset: 0 any more', () => {
    // The regression this guards: sheet-root and pa-stage were `inset: 0` /
    // `bottom: calc(...)`, which the keyboard does not move.
    const strip = (css: string) => css.replace(/\/\*[^]*?\*\//g, '');
    const sheet = strip(readFileSync('src/components/sheet.css', 'utf8'));
    const stage = strip(readFileSync('src/ar/arspace.css', 'utf8'));
    const sheetRoot = sheet.slice(sheet.indexOf('.sheet-root'), sheet.indexOf('.sheet-backdrop'));
    const paStage = stage.slice(stage.indexOf('.pa-stage {'), stage.indexOf('.pa-topbar'));
    expect(sheetRoot).not.toMatch(/inset:\s*0/);
    expect(sheetRoot).toMatch(/height:\s*var\(--app-h/);
    expect(paStage).toMatch(/height:\s*calc\(var\(--app-h/);
    expect(paStage).not.toMatch(/bottom:\s*calc/);
  });
});
