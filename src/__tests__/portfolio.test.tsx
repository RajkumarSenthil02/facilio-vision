// PR-B1 slice of portfolio-smoke: pick a location, list assets scoped to it,
// open one. (Work orders extend this in PR-B2.)
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../App';

function bootAt(query: string) {
  window.history.replaceState({}, '', `/${query}`);
  return render(<App />);
}

describe('portfolio (mock mode)', () => {
  it('scopes assets to the picked site, including assets parented directly to it', async () => {
    const user = userEvent.setup();
    bootAt('?mock=1&tab=portfolio');

    // Unscoped: all fixtures visible
    expect(await screen.findByText('Conveyor Motor M-114')).toBeInTheDocument();

    // Scope to Greenfield (site 1001)
    await screen.findByRole('option', { name: 'Greenfield Business Park' });
    await user.selectOptions(screen.getByLabelText('Site'), '1001');

    expect(await screen.findByText('AHU-03')).toBeInTheDocument();
    expect(screen.getByText('UPS-A2')).toBeInTheDocument();
    // The site-parented asset must appear — naive space-only scoping loses it
    expect(screen.getByText('Campus Chiller CH-01')).toBeInTheDocument();
    // Other sites' assets are gone
    expect(screen.queryByText('Conveyor Motor M-114')).not.toBeInTheDocument();

    // Narrow to Tower A → Floor 3
    await user.selectOptions(screen.getByLabelText('Building'), '1501');
    await user.selectOptions(screen.getByLabelText('Floor'), '1801');
    expect(await screen.findByText('AHU-03')).toBeInTheDocument();
    expect(screen.queryByText('Campus Chiller CH-01')).not.toBeInTheDocument();
  });

  it('remembers the location for the session (2.7 sticky)', async () => {
    const user = userEvent.setup();
    const first = bootAt('?mock=1&tab=portfolio');
    await screen.findByRole('option', { name: 'Lakeside Manufacturing Plant' });
    await user.selectOptions(screen.getByLabelText('Site'), '1002');
    expect(await screen.findByText(/Scope: Lakeside/)).toBeInTheDocument();
    first.unmount();

    // Remount = new page load in the same session
    bootAt('?mock=1&tab=portfolio');
    expect(await screen.findByText(/Scope: Lakeside/)).toBeInTheDocument();
    expect(await screen.findByText('Feed Pump P-07')).toBeInTheDocument();
  });

  it('text search + open asset detail', async () => {
    const user = userEvent.setup();
    bootAt('?mock=1&tab=portfolio');

    await user.type(await screen.findByPlaceholderText('Search assets by name…'), 'pump');
    expect(await screen.findByText('Feed Pump P-07')).toBeInTheDocument();
    expect(screen.queryByText('AHU-03')).not.toBeInTheDocument();

    await user.click(screen.getByText('Feed Pump P-07'));
    expect(await screen.findByRole('heading', { name: 'Feed Pump P-07' })).toBeInTheDocument();
    expect(screen.getByText('#3004')).toBeInTheDocument();
  });
});
