// Design-system smoke for the Dock HUD stage: zones render, markers carry
// live WO-derived status, minimize ⇄ restore works, AR toggle empties zone D.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../App';

function bootAt(query: string) {
  window.history.replaceState({}, '', `/${query}`);
  return render(<App />);
}

describe('AR HUD (mock mode)', () => {
  it('renders topbar zones, markers with WO counts, candidates and dock', async () => {
    bootAt('?mock=1&tab=ar');

    // Zone A/B/C bar
    expect(await screen.findByText('All sites')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AR on' })).toBeInTheDocument();

    // Zone D markers from fixtures: AHU-03 has one open WO → red edge + count
    const tag = await screen.findByRole('button', { name: /HVAC · Open Office 3F/ });
    expect(tag).toHaveClass('ar-asset-tag');
    // Several fixture assets carry one open WO each — assert at least one count chip
    expect((await screen.findAllByText('1 open')).length).toBeGreaterThan(0);

    // Marker family co-exists
    expect(screen.getByText('Belt slipping — check on next PM')).toBeInTheDocument();
    expect(screen.getByText('WS-01')).toBeInTheDocument();

    // Zone F dock with marker count badge
    expect(screen.getByRole('button', { name: /Markers/ })).toBeInTheDocument();
  });

  it('select → minimize → restore an asset tag', async () => {
    const user = userEvent.setup();
    bootAt('?mock=1&tab=ar');

    const tag = await screen.findByRole('button', { name: /HVAC · Open Office 3F/ });
    await user.click(tag); // select
    expect(tag).toHaveClass('selected');

    await user.click(tag); // second tap minimizes
    const dot = await screen.findByRole('button', { name: 'Restore AHU-03' });
    expect(dot).toHaveClass('ar-min-dot');

    await user.click(dot); // restore
    expect(await screen.findByRole('button', { name: /HVAC · Open Office 3F/ })).toHaveClass('ar-asset-tag');
  });

  it('AR toggle clears zone D but keeps the shell', async () => {
    const user = userEvent.setup();
    bootAt('?mock=1&tab=ar');

    await screen.findByRole('button', { name: /HVAC · Open Office 3F/ });
    await user.click(screen.getByRole('button', { name: 'AR on' }));

    expect(screen.queryByRole('button', { name: /HVAC · Open Office 3F/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AR off' })).toBeInTheDocument();
    // Tab bar still there — the stage never owns the app chrome
    expect(screen.getByRole('tab', { name: 'Surveys' })).toBeInTheDocument();
  });
});
