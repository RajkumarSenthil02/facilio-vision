// WS-B acceptance: the maintenance loop a technician actually runs —
// stand at a standpoint (scan its sticker), see the asset marker, open its
// work orders, tick a task, move the status, pin a note for the next person,
// and find that note still there after the app is remounted.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  id: 'sv-pump',
  name: 'WS-07 · Plant room door',
  siteId: 1001,
  spaceName: 'Open Office 3F',
  geo: null,
  qrCode: 'ws-07-code',
  sweep: [{ heading: 210, pitch: 0, vec: { q: '', s: 1, dim: 0 } }],
  markers: [{ id: 'm-ahu', label: 'AHU-03', heading: 20, pitch: 0, assetId: 3001 }],
  modelId: 'luma64-v0',
  createdAt: '2026-08-01T00:00:00.000Z',
};

function seed() {
  localStorage.setItem(`fv.mockKv.surveys.survey.${SURVEY.id}`, JSON.stringify(SURVEY));
  localStorage.setItem(
    `fv.mockKv.codes.${SURVEY.qrCode}`,
    JSON.stringify({
      code: SURVEY.qrCode,
      type: 'survey',
      surveyId: SURVEY.id,
      createdAt: SURVEY.createdAt,
    }),
  );
}

/** Boot the AR tab, turn AR on, scan the standpoint sticker. */
async function standAtStandpoint() {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/?mock=1&tab=ar');
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'AR off' }));
  await act(async () => {
    scanBus.emit?.(SURVEY.qrCode as string);
  });
  await screen.findByText(`Localized · ${SURVEY.name} · QR`);
  return user;
}

describe('AR maintenance loop (mock mode)', () => {
  it('scan → marker → work orders → task → status → note → survives a remount', async () => {
    seed();
    const user = await standAtStandpoint();

    // the survey's asset marker, coloured by its live work orders
    const marker = await screen.findByRole('button', { name: /AHU-03/ });
    expect(marker).toHaveClass('ar-asset-tag');
    // its work orders land a beat later and colour the marker red
    await waitFor(() => expect(within(marker).getByText('1 open')).toBeInTheDocument());
    expect(marker.querySelector('.edge')).toHaveClass('st-red');

    // focusing it opens the in-view work order panel
    await user.click(marker);
    const panel = await screen.findByRole('complementary');
    expect(within(panel).getByRole('heading', { name: 'AHU-03' })).toBeInTheDocument();

    const woRow = await within(panel).findByRole('button', {
      name: /AHU-03 vibration above threshold/,
    });
    await user.click(woRow);

    // tick a checklist task
    const task = await within(panel).findByRole('button', {
      name: 'Complete: Measure vibration at bearing housings',
    });
    await user.click(task);
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', {
          name: 'Reopen: Measure vibration at bearing housings',
        }),
      ).toBeInTheDocument(),
    );

    // move the work order status through the catalogue
    await user.click(within(panel).getByRole('combobox', { name: 'Move to' }));
    await user.click(await within(panel).findByRole('option', { name: 'Closed' }));
    await waitFor(() => expect(panel.querySelector('.badge')).toHaveTextContent('Closed'));

    // pin a note at this standpoint for whoever comes next
    await user.click(screen.getByRole('button', { name: /Pin note/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Note/ }),
      'Left the isolation valve half open',
    );
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(
      await screen.findByRole('button', { name: /Left the isolation valve half open/ }),
    ).toBeInTheDocument();

    // ---- remount: the note is in the survey, not in React state ----
    cleanup();
    await standAtStandpoint();
    expect(
      await screen.findByRole('button', { name: /Left the isolation valve half open/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /AHU-03/ })).toBeInTheDocument();
  });

  it('the marker index lists both markers and can guide to one', async () => {
    seed();
    const user = await standAtStandpoint();
    await screen.findByRole('button', { name: /AHU-03/ });

    await user.click(screen.getByRole('button', { name: /Markers/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Marker index' });
    const rows = within(sheet).getAllByRole('button', { name: 'Guide' });
    expect(rows).toHaveLength(SURVEY.markers.length);

    // abs = (sweep[0].heading + marker.heading + Δ) % 360 = (210 + 20 + 0) % 360
    expect(within(sheet).getByText('230°')).toBeInTheDocument();

    await user.click(rows[0]);
    expect(await screen.findByText('AHU-03', { selector: '.vs-guide-name' })).toBeInTheDocument();
  });
});
