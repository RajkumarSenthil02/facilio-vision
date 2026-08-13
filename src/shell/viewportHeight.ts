/**
 * Keeps --app-h equal to what is ACTUALLY visible.
 *
 * 100dvh fixed the iPhone case, but on iPad the desktop shell still came up
 * short and left a dead band under the app. The visual viewport is the only
 * source that is right on every platform, so measure it and let CSS keep
 * 100dvh purely as the pre-JS fallback.
 */
export function installViewportHeight(): void {
  const apply = () => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    if (h > 0) document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
  // Safari settles its chrome after load; re-measure once it has.
  window.addEventListener('load', () => setTimeout(apply, 120));
}
