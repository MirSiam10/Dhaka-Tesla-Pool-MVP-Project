'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { clock, eventLabel, taka } from '@/lib/format';
import type { RideEvent } from '@/lib/types';
import { ErrorBanner } from './ui';

/**
 * The ride's own audit trail (append-only ride_events). Loaded lazily when opened, and the
 * parent remounts it with a new `key` when the ride's status changes so it never goes stale.
 */
export function RideTimeline({ rideId }: { rideId: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<RideEvent[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .rideEvents(rideId)
      .then((e) => !cancelled && setEvents(e))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [open, rideId]);

  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>What happened on this ride</summary>
      <ErrorBanner error={error} />
      {open && !events && !error && <p className="small muted">Loading…</p>}
      {events && (
        <ol className="timeline">
          {events.map((ev, i) => (
            <li key={i}>
              <strong>{eventLabel(ev.type)}</strong> <span className="muted">· {clock(ev.at)}</span>
              {ev.type === 'FARE_CHANGED' && typeof ev.metadata.toPaisa === 'number' && typeof ev.metadata.fromPaisa === 'number' ? (
                <span className="muted">
                  {' '}
                  · {taka(ev.metadata.fromPaisa)} to {taka(ev.metadata.toPaisa)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
