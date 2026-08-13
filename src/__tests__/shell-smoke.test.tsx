// Phase 1 acceptance: app loads, both tabs render, a deliberately thrown
// screen error shows a readable panel while the tab bar still works.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';

function bootAt(query: string) {
  window.history.replaceState({}, '', `/${query}`);
  return render(<App />);
}

describe('shell-smoke', () => {
  it('loads in mock mode and renders both visible tabs', async () => {
    bootAt('?mock=1');

    // Auth gate resolves against the mock provider
    expect(await screen.findByRole('tab', { name: 'AR' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Surveys' })).toBeInTheDocument();

    // Hidden screens stay out of the bar
    expect(screen.queryByRole('tab', { name: 'Diagnostics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Boom' })).not.toBeInTheDocument();

    // Default tab renders the AR stage with the camera ALREADY live —
    // camera-first: no tap required to see through the lens.
    expect(await screen.findByRole('button', { name: 'AR on' })).toBeInTheDocument();
  });

  it('switches tabs and rewrites only the tab param', async () => {
    const user = userEvent.setup();
    bootAt('?mock=1');

    await user.click(await screen.findByRole('tab', { name: 'Surveys' }));
    expect(await screen.findByRole('heading', { name: 'Surveys' })).toBeInTheDocument();

    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('surveys');
    expect(params.get('mock')).toBe('1'); // preserved

    // The surveys registry offers its authoring entry point
    expect(
      await screen.findByRole('button', { name: 'Place assets (AR survey)' }),
    ).toBeInTheDocument();
  });

  it('hidden screens join the bar when active via ?tab=', async () => {
    bootAt('?mock=1&tab=diagnostics');

    expect(await screen.findByRole('tab', { name: 'Diagnostics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    // The two visible tabs are still there alongside it
    expect(screen.getByRole('tab', { name: 'AR' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Surveys' })).toBeInTheDocument();
  });

  it('a deliberately thrown screen error shows a readable panel while the tab bar still works', async () => {
    // React logs caught boundary errors loudly; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    bootAt('?mock=1&tab=boom');

    // Readable panel, not a blank page
    const panel = await screen.findByRole('alert');
    expect(panel).toHaveTextContent('The Boom screen crashed');
    expect(panel).toHaveTextContent('Deliberate crash from ?tab=boom');

    // Tab bar survived and still navigates
    await user.click(screen.getByRole('tab', { name: 'Surveys' }));
    expect(await screen.findByRole('heading', { name: 'Surveys' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
