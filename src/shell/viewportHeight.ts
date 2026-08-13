/**
 * Keeps --app-h equal to what is ACTUALLY visible — and owns the keyboard.
 *
 * 100dvh fixed the iPhone case, but on iPad the desktop shell still came up
 * short and left a dead band under the app. The visual viewport is the only
 * source that is right on every platform, so measure it and let CSS keep
 * 100dvh purely as the pre-JS fallback.
 *
 * KEYBOARD: when the on-screen keyboard opens, the visual viewport shrinks
 * but the LAYOUT viewport does not — so anything anchored `bottom: 0` with
 * position:fixed stays under the keyboard (hidden buttons), while the
 * flex-laid dock rode up on top of it (the "icons go up" report). Three
 * things fix all of it at once:
 *   - `kb-open` on <html> while a keyboard is up → CSS hides the dock and
 *     lets full-screen surfaces use the whole visible area
 *   - every full-screen surface is sized by --app-h (never `bottom: 0`), so
 *     shrinking --app-h moves footers ABOVE the keyboard
 *   - --vv-top mirrors visualViewport.offsetTop, so if iOS pans the page to
 *     reveal a focused input, the app is translated back under the finger
 */
export function installViewportHeight(): void {
  /** Anything smaller than this is browser chrome settling, not a keyboard. */
  const KEYBOARD_MIN_PX = 120;

  const apply = () => {
    const vv = window.visualViewport;
    const h = vv?.height ?? window.innerHeight;
    if (h > 0) document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    document.documentElement.style.setProperty('--vv-top', `${Math.round(vv?.offsetTop ?? 0)}px`);
    const keyboard = window.innerHeight - h > KEYBOARD_MIN_PX;
    document.documentElement.classList.toggle('kb-open', keyboard);
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
  // iOS fires focus before the keyboard finishes animating — settle late.
  window.addEventListener('focusin', () => setTimeout(apply, 250));
  window.addEventListener('focusout', () => setTimeout(apply, 250));
  // Safari settles its chrome after load; re-measure once it has.
  window.addEventListener('load', () => setTimeout(apply, 120));
}
