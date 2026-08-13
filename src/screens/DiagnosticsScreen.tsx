import { useEffect, useState } from 'react';
import { provider, isMockMode } from '../api/provider';
import { detectEmbed } from '../shell/embed';
import type { CurrentUser } from '../api/types';

// Hidden dev/debug screen (?tab=diagnostics): the fastest way to answer
// "what session, what mode, what host is this running in?" from a phone.
export default function DiagnosticsScreen() {
  const [me, setMe] = useState<CurrentUser | null | 'loading'>('loading');
  const embed = detectEmbed();

  useEffect(() => {
    let cancelled = false;
    provider
      .getCurrentUser()
      .then((user) => {
        if (!cancelled) setMe(user);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Array<[string, string]> = [
    ['Provider', isMockMode() ? 'mock (?mock=1)' : 'real (facilio-cmms)'],
    ['User', me === 'loading' ? '…' : me ? `${me.user.name} <${me.user.email}>` : 'signed out'],
    ['Org', me === 'loading' || !me ? '—' : String(me.org.orgId)],
    ['Embedded', embed.embedded ? 'yes' : 'no'],
    ['capp_id', embed.cappId ?? '—'],
    ['origin', embed.origin ?? '—'],
    ['URL', window.location.href],
    ['User agent', navigator.userAgent],
  ];

  return (
    <section className="screen">
      <h2>Diagnostics</h2>
      <table className="diag-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
