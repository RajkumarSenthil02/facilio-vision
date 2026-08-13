// The asset picker is a DROPDOWN, not a bare search box: options are visible
// the moment it opens (an empty query lists the scope), the filter narrows,
// and choosing never commits a marker by itself.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import AssetSelect from '../components/AssetSelect';
import type { Asset } from '../api/types';

/** The control is controlled — a real parent holds the choice. */
function Host({ onPick }: { onPick: (a: Asset) => void }) {
  const [value, setValue] = useState<Asset | null>(null);
  return (
    <AssetSelect
      value={value}
      scopeSiteId={undefined}
      onPick={(a) => {
        setValue(a);
        onPick(a);
      }}
    />
  );
}

function mount(onPick: (a: Asset) => void) {
  window.history.replaceState({}, '', '/?mock=1');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Host onPick={onPick} />
    </QueryClientProvider>,
  );
}

describe('AssetSelect', () => {
  it('opens as a combobox and lists the scope WITHOUT typing anything', async () => {
    const user = userEvent.setup();
    mount(() => undefined);

    const trigger = screen.getByRole('combobox', { name: 'Asset' });
    expect(trigger).toHaveClass('ds-select-btn'); // the DSM control, not a bare input
    await user.click(trigger);

    // options appear with an EMPTY query — that was the whole complaint
    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(2);
  });

  it('the filter narrows and picking closes the list', async () => {
    const user = userEvent.setup();
    const picked: Asset[] = [];
    mount((a) => picked.push(a));

    await user.click(screen.getByRole('combobox', { name: 'Asset' }));
    await screen.findAllByRole('option');
    await user.type(screen.getByLabelText('Filter assets'), 'ahu');

    await waitFor(() => {
      const rows = screen.getAllByRole('option');
      expect(rows.every((r) => /ahu/i.test(r.textContent ?? ''))).toBe(true);
    });

    await user.click(screen.getAllByRole('option')[0]);
    expect(picked).toHaveLength(1);
    expect(screen.queryByRole('option')).toBeNull(); // closed
    // the trigger now names the choice
    expect(screen.getByRole('combobox', { name: 'Asset' })).toHaveTextContent(picked[0].name);
  });
});
