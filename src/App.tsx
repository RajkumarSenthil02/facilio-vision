import { useEffect, useMemo, useState } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import AuthGate from './auth/AuthGate';
import { detectEmbed } from './shell/embed';
import { installGlobalErrorHandlers, onGlobalError } from './shell/globalErrors';
import { createAppQueryClient, createPersistOptions } from './api/queryClient';
import { onQueueChange, flushQueue } from './api/offlineQueue';
import { LocationProvider } from './state/LocationContext';
import {
  AppShell,
  CameraIcon,
  ClipboardListIcon,
  HomeIcon,
  LayoutGridIcon,
  MapPinIcon,
  MicIcon,
  RouteIcon,
  SettingsIcon,
  type ShellScreen,
} from './layout';
import ARScreen from './screens/ARScreen';
import SurveysScreen from './screens/SurveysScreen';
import PortfolioScreen from './screens/PortfolioScreen';
import CaptureScreen from './screens/CaptureScreen';
import RoomsScreen from './screens/RoomsScreen';
import VoiceSheet from './screens/VoiceSheet';
import DashboardScreen from './screens/DashboardScreen';
import RoundsScreen, { ActiveRoundChip } from './screens/RoundsScreen';
import SettingsScreen from './screens/SettingsScreen';
import DiagnosticsScreen from './screens/DiagnosticsScreen';
import BoomScreen from './screens/BoomScreen';

installGlobalErrorHandlers();

// Thumb economy on camera surfaces: two visible tabs (design rule 1.5).
// Everything else is reachable by ?tab= — and on the desktop admin layout the
// hidden screens surface in the sidebar under Admin (that's the web layout's
// whole point).
const SCREENS: ShellScreen[] = [
  { id: 'ar', label: 'AR', icon: <CameraIcon />, visible: true, bleed: true, component: ARScreen },
  { id: 'surveys', label: 'Surveys', icon: <MapPinIcon />, visible: true, component: SurveysScreen },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutGridIcon />, visible: false, component: DashboardScreen },
  { id: 'portfolio', label: 'Portfolio', icon: <HomeIcon />, visible: false, component: PortfolioScreen },
  { id: 'capture', label: 'Capture', icon: <CameraIcon />, visible: false, bleed: true, component: CaptureScreen },
  { id: 'rooms', label: 'Rooms', icon: <HomeIcon />, visible: false, component: RoomsScreen },
  { id: 'voice', label: 'Voice', icon: <MicIcon />, visible: false, component: VoiceSheet },
  { id: 'rounds', label: 'Rounds', icon: <RouteIcon />, visible: false, component: RoundsScreen },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon />, visible: false, component: SettingsScreen },
  { id: 'diagnostics', label: 'Diagnostics', icon: <ClipboardListIcon />, visible: false, component: DiagnosticsScreen },
  { id: 'boom', label: 'Boom', visible: false, component: BoomScreen },
];

export default function App() {
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const embed = detectEmbed();

  const queryClient = useMemo(createAppQueryClient, []);
  const persistOptions = useMemo(() => createPersistOptions(), []);

  useEffect(() => onGlobalError(setGlobalError), []);
  useEffect(() => onQueueChange(setPendingWrites), []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <div className={embed.embedded ? 'app embedded' : 'app'}>
        {globalError && (
          <div className="global-error-banner" role="alert">
            <span>{globalError}</span>
            <button onClick={() => setGlobalError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {pendingWrites > 0 && (
          <div className="offline-banner" role="status">
            <span>
              {pendingWrites} change{pendingWrites === 1 ? '' : 's'} waiting for connection
            </span>
            <button onClick={() => void flushQueue()}>Retry now</button>
          </div>
        )}
        <AuthGate embedded={embed.embedded}>
          {() => (
            <LocationProvider>
              <ActiveRoundChip />
              <AppShell screens={SCREENS} />
            </LocationProvider>
          )}
        </AuthGate>
      </div>
    </PersistQueryClientProvider>
  );
}
