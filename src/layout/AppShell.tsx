import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import ErrorBoundary from '../shell/ErrorBoundary';
import { detectEmbed } from '../shell/embed';
import './layout.css';

/**
 * Adaptive shell — TabShell's registry/param-preserving navigation, rendered
 * in one of three chromes chosen at render time:
 *
 *   embedded  detectEmbed().embedded — compact top pill tabs (the current
 *             TabShell visual; `.app.embedded` paddings apply from styles.css)
 *   desktop   ≥1024px and NOT embedded — admin web layout: 56px topbar +
 *             240px sidebar. Hidden screens are ALWAYS listed here, under an
 *             'Admin' nav section — that is the point of the admin layout.
 *   mobile    everything else — camera-first: 52px bottom icon dock with only
 *             the visible screens; hidden ones join via ?tab= while active,
 *             exactly like today.
 *
 * Driven entirely by props so the integrator can swap it in for TabShell
 * without this file knowing the screen registry.
 */

export interface ShellScreen {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Hidden screens are reachable by ?tab= and join mobile/embedded nav only while active. */
  visible: boolean;
  component: ComponentType;
}

export interface AppShellProps {
  screens: ShellScreen[];
  /** Fallback tab when the URL names none (or an unknown one). Defaults to the first visible screen. */
  initialTab?: string;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function tabFromLocation(screens: ShellScreen[], initialTab?: string): string {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (wanted !== null && screens.some((s) => s.id === wanted)) return wanted;
  if (initialTab !== undefined && screens.some((s) => s.id === initialTab)) return initialTab;
  return (screens.find((s) => s.visible) ?? screens[0])?.id ?? '';
}

/** Rewrite ONLY the tab param — mock/capp_id/origin/login must survive navigation. */
function pushTab(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', id);
  window.history.pushState({}, '', url);
}

/** jsdom (tests) has no matchMedia — treat "can't tell" as not-desktop. */
function desktopNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;
}

export default function AppShell({ screens, initialTab }: AppShellProps) {
  const [active, setActive] = useState(() => tabFromLocation(screens, initialTab));
  const [desktop, setDesktop] = useState(desktopNow);
  const embedded = detectEmbed().embedded;

  useEffect(() => {
    const onPopState = () => setActive(tabFromLocation(screens, initialTab));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [screens, initialTab]);

  // Live mode switch: rotating a tablet or resizing the admin window re-lays
  // the chrome without losing the mounted screen.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  if (screens.length === 0) return null;

  const activeScreen =
    screens.find((s) => s.id === active) ?? screens.find((s) => s.visible) ?? screens[0];
  const ActiveComponent = activeScreen.component;

  const select = (id: string) => {
    if (id === activeScreen.id) return;
    pushTab(id);
    setActive(id);
  };

  // Mobile/embedded nav: visible screens, plus the active one if hidden.
  const joinNav = screens.filter((s) => s.visible || s.id === activeScreen.id);
  const visibleScreens = screens.filter((s) => s.visible);
  const hiddenScreens = screens.filter((s) => !s.visible);

  // key resets the boundary when the tab changes, so one crashed screen
  // never poisons the next one the user switches to
  const body = (
    <ErrorBoundary key={activeScreen.id} screen={activeScreen.label}>
      <ActiveComponent />
    </ErrorBoundary>
  );

  if (embedded) {
    return (
      <div className="tab-shell as-embedded">
        <nav className="tab-bar" role="tablist" aria-label="Screens">
          {joinNav.map((screen) => (
            <button
              key={screen.id}
              role="tab"
              aria-selected={screen.id === activeScreen.id}
              className={screen.id === activeScreen.id ? 'tab active' : 'tab'}
              onClick={() => select(screen.id)}
            >
              {screen.label}
            </button>
          ))}
        </nav>
        {body}
      </div>
    );
  }

  const navItem = (screen: ShellScreen) => (
    <button
      key={screen.id}
      role="tab"
      aria-selected={screen.id === activeScreen.id}
      className={screen.id === activeScreen.id ? 'nav-item active' : 'nav-item'}
      onClick={() => select(screen.id)}
    >
      {screen.icon}
      <span>{screen.label}</span>
    </button>
  );

  if (desktop) {
    return (
      <div className="as-desktop">
        <header className="as-topbar">
          <div className="as-logo">
            <span className="as-logo-word">Facilio</span>
            <span className="as-logo-sub">Vision</span>
          </div>
        </header>
        <aside className="as-sidebar">
          <nav className="as-nav" role="tablist" aria-label="Sidebar">
            <div className="nav-section">Workspace</div>
            {visibleScreens.map(navItem)}
            {hiddenScreens.length > 0 && (
              <>
                <div className="nav-section">Admin</div>
                {hiddenScreens.map(navItem)}
              </>
            )}
          </nav>
        </aside>
        <main className="as-main">{body}</main>
      </div>
    );
  }

  return (
    <div className="as-mobile">
      <main className="as-mobile-main">{body}</main>
      <nav className="as-dock" role="tablist" aria-label="Dock">
        {joinNav.map((screen) => (
          <button
            key={screen.id}
            role="tab"
            aria-selected={screen.id === activeScreen.id}
            className={screen.id === activeScreen.id ? 'dock-item active' : 'dock-item'}
            onClick={() => select(screen.id)}
          >
            {/* decorative: the label below is the button's accessible name */}
            <span className="dock-icon" aria-hidden="true">
              {screen.icon ?? <span className="dock-letter">{screen.label.slice(0, 1)}</span>}
            </span>
            <span className="dock-label">{screen.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
