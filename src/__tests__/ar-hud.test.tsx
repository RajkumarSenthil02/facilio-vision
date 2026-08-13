// Design-system smoke for the Dock HUD stage, now over the REAL camera:
// the zones render, the camera is live on open (camera-first), and
// the motion sensors, and the marker board minimizes/restores (persisted).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Survey } from '../api/types';

const scanBus = vi.hoisted(() => ({ emit: null as ((code: string) => void) | null }));
vi.mock('../vision/scanLoop', async () => {
  const React = await import('react');
  return {
    useScanLoop: () => {
      const [qrHit, setQrHit] = React.useState<{ code: string; at: number } | null>(null);
      React.useEffect(() => {
        scanBus.emit = (code: string) => setQrHit({ code, at: Date.now() });
        return () => {
          scanBus.emit = null;
        };
      }, []);
      return {
        candidates: [],
        locked: null,
        qrHit,
        hint: null,
        stats: { ticks: 0, embeds: 0, embedMs: 0, embedIntervalMs: 500, indexSize: 0 },
      };
    },
  };
});

const SURVEY: Survey = {
  id: 'sv-hud',
  name: 'WS-01',
  spaceName: 'Open Office 3F',
  geo: null,
  qrCode: 'ws-01-code',
  sweep: [{ heading: 0, pitch: 0, vec: { q: '', s: 1, dim: 0 } }],
  markers: [
    { id: 'm1', label: 'AHU-03', heading: 10, pitch: 0, assetId: 3001 },
    { id: 'm2', label: 'Belt slipping — check on next PM', heading: 40, pitch: -3, note: 'x' },
  ],
  modelId: 'luma64-v0',
  createdAt: '2026-08-01T00:00:00.000Z',
};

function seed() {
  localStorage.setItem(`fv.mockKv.surveys.survey.${SURVEY.id}`, JSON.stringify(SURVEY));
  localStorage.setItem(
    `fv.mockKv.codes.${SURVEY.qrCode}`,
    JSON.stringify({ code: SURVEY.qrCode, type: 'survey', surveyId: SURVEY.id, createdAt: SURVEY.createdAt }),
  );
}

function bootAt(query: string) {
  window.history.replaceState({}, '', `/${query}`);
  return render(<App />);
}

afterEach(() => {
  delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
});

describe('AR HUD (mock mode)', () => {
  it('renders the topbar zones, the crosshair and the dock', async () => {
    const { container } = bootAt('?mock=1&tab=ar');

    // Zone A: site context chip
    expect(await screen.findByText('All sites')).toBeInTheDocument();
    // Zone B: exactly ONE state chip
    expect(container.querySelectorAll('.ar-state')).toHaveLength(1);
    // Zone C: the AR toggle, ON by default
    expect(screen.getByRole('button', { name: 'AR on' })).toBeInTheDocument();
    // Zone D + F
    expect(container.querySelector('.ar-crosshair')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Markers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Raise fault/ })).toBeInTheDocument();
    // camera-first: the feed surface is mounted without any tap
    await waitFor(() => expect(container.querySelector('.fv-cam')).not.toBeNull());
  });

  it('camera is live on open; the first touch arms the iOS motion sensors', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission,
    };
    const user = userEvent.setup();
    const { container } = bootAt('?mock=1&tab=ar');

    // No tap needed: the feed surface mounts inside the stage on open.
    const stage = (await screen.findByRole('button', { name: 'AR on' })).closest(
      '.ar-stage',
    ) as HTMLElement;
    await waitFor(() => expect(stage.querySelector('.fv-cam')).not.toBeNull());
    expect(within(stage).getByText(/Camera unavailable here/)).toBeInTheDocument();
    // the app chrome is never owned by the stage
    expect(screen.getByRole('tab', { name: 'Surveys' })).toBeInTheDocument();

    // iOS gates MOTION (not camera) behind a gesture — the first touch arms it
    await user.click(stage);
    await waitFor(() => expect(requestPermission).toHaveBeenCalled());

    // toggling off still tears the feed down
    await user.click(screen.getByRole('button', { name: 'AR on' }));
    expect(container.querySelector('.fv-cam')).toBeNull();
    expect(screen.getByText('AR paused')).toBeInTheDocument();
  });

  it('markers appear once localized, and the board minimizes ⇄ restores (persisted)', async () => {
    seed();
    const user = userEvent.setup();
    bootAt('?mock=1&tab=ar');

    await screen.findByRole('button', { name: 'AR on' });
    await act(async () => {
      scanBus.emit?.('ws-01-code');
    });

    // Zone D: the survey's markers, asset tag + note tag
    const tag = await screen.findByRole('button', { name: /AHU-03/ });
    expect(tag).toHaveClass('ar-asset-tag');
    // the note marker renders as a note tag (and, off-view, as an edge chevron)
    expect(
      screen.getByText('Belt slipping — check on next PM', { selector: '.txt' }),
    ).toBeInTheDocument();
    // dock badge counts them
    expect(screen.getByRole('button', { name: /Markers/ })).toHaveTextContent('2');

    // minimize from the marker index
    await user.click(screen.getByRole('button', { name: /Markers/ }));
    await user.click(await screen.findByRole('button', { name: 'Minimize marker board' }));
    expect(screen.queryByRole('button', { name: /AHU-03/ })).not.toBeInTheDocument();

    const restore = await screen.findByRole('button', { name: /Restore markers \(2\)/ });
    expect(restore).toHaveClass('ar-board-restore');
    await waitFor(() =>
      expect(localStorage.getItem('fv.mockKv.settings.board.none')).toBe('{"minimized":true}'),
    );

    // restore
    await user.click(restore);
    expect(await screen.findByRole('button', { name: /AHU-03/ })).toHaveClass('ar-asset-tag');
    await waitFor(() =>
      expect(localStorage.getItem('fv.mockKv.settings.board.none')).toBe('{"minimized":false}'),
    );
  });
});
