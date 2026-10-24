'use client';

import { useEffect, useRef, useState } from 'react';
import { ActiveRide } from '@/components/ActiveRide';
import { BookingForm } from '@/components/BookingForm';
import { RideTimeline } from '@/components/RideTimeline';
import { Shell } from '@/components/Shell';
import { EmptyState, ErrorBanner, Notice, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ACTIVE_RIDE_STATUSES, clock, taka } from '@/lib/format';
import type { Zone } from '@/lib/types';
import { usePolling } from '@/lib/usePolling';

export default function PassengerPage() {
  return (
    <Shell role="PASSENGER">
      <PassengerHome />
    </Shell>
  );
}

function PassengerHome() {
  const { user, refreshUser } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonesError, setZonesError] = useState<Error | null>(null);
  const rides = usePolling(() => api.rides(), 3000);

  useEffect(() => {
    api.zones().then(setZones).catch(setZonesError);
  }, []);

  const list = rides.data ?? [];
  const active = list.find((r) => ACTIVE_RIDE_STATUSES.includes(r.status));
  const past = list.filter((r) => !ACTIVE_RIDE_STATUSES.includes(r.status));

  // A completed TeslaPay ride changes the wallet, so re-read the profile when one finishes.
  const completed = list.filter((r) => r.status === 'COMPLETED').length;
  const lastCompleted = useRef<number | null>(null);
  useEffect(() => {
    if (!rides.data) return;
    if (lastCompleted.current !== null && completed > lastCompleted.current) void refreshUser();
    lastCompleted.current = completed;
  }, [completed, rides.data, refreshUser]);

  const justFinished = !active && past[0]?.status === 'COMPLETED' ? past[0] : undefined;

  return (
    <>
      <h1>Hello, {user?.name}</h1>
      <ErrorBanner error={zonesError} />
      {rides.error && !rides.data && <ErrorBanner error={rides.error} />}
      {rides.error && rides.data && <Notice tone="warn">Connection problem, retrying. Showing the last known status.</Notice>}

      {rides.loading ? (
        <div className="card">
          <Skeleton lines={4} />
        </div>
      ) : active ? (
        <ActiveRide ride={active} onChanged={() => void rides.refresh()} />
      ) : (
        <>
          {justFinished && (
            <Notice>
              Trip complete: {justFinished.pickup.name} to {justFinished.destination.name}, {taka(justFinished.fare.totalFarePaisa)}.
            </Notice>
          )}
          {zones.length > 0 && user ? (
            <BookingForm zones={zones} user={user} onBooked={() => void rides.refresh()} />
          ) : (
            !zonesError && (
              <div className="card">
                <Skeleton lines={3} />
              </div>
            )
          )}
        </>
      )}

      <section className="card" aria-label="Ride history">
        <h2>Your rides</h2>
        {rides.loading ? (
          <Skeleton lines={2} />
        ) : past.length === 0 ? (
          <EmptyState title="No past rides yet" hint="Completed and cancelled rides appear here." />
        ) : (
          <ul className="list">
            {past.map((r) => (
              <li key={r.id}>
                <div className="card-title">
                  <strong>
                    {r.pickup.name} → {r.destination.name}
                  </strong>
                  <StatusPill status={r.status} />
                </div>
                <div className="small muted">
                  {clock(r.timestamps.requestedAt ?? '')} · {r.seats} {r.seats === 1 ? 'seat' : 'seats'} ·{' '}
                  {r.status === 'CANCELLED' ? 'no charge' : taka(r.fare.totalFarePaisa)}
                  {r.fare.poolDiscountPaisa > 0 && r.status === 'COMPLETED' ? ` (saved ${taka(r.fare.poolDiscountPaisa)} by sharing)` : ''}
                </div>
                <RideTimeline rideId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
