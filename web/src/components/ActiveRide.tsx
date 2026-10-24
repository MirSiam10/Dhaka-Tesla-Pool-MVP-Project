'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { km, taka } from '@/lib/format';
import type { Ride } from '@/lib/types';
import { RideTimeline } from './RideTimeline';
import { ErrorBanner, FareTable, RideSteps, StatusPill } from './ui';

function statusMessage(ride: Ride): string {
  const pool = ride.pool;
  switch (ride.status) {
    case 'REQUESTED':
      return 'Waiting for a driver. If a Tesla that is already boarding has a free seat on your route, you will be matched instantly.';
    case 'MATCHED': {
      const others = pool?.coPassengers ?? 0;
      const sharing = others > 0 ? ` You are sharing with ${others} other ${others === 1 ? 'rider' : 'riders'}.` : ' No one else has joined yet.';
      return `${pool?.vehicleName} (${pool?.vehiclePlate}) with ${pool?.driverName} is heading to ${ride.pickup.name}.${sharing}`;
    }
    case 'DRIVER_ARRIVED':
      return `${pool?.vehicleName} is at ${ride.pickup.name}. Boarding is closed, so your fare is final.`;
    case 'STARTED':
      return `On the way to ${ride.destination.name} in ${pool?.vehicleName}.`;
    case 'COMPLETED':
      return 'You have arrived. Thanks for riding.';
    case 'CANCELLED':
      return 'This ride was cancelled.';
  }
}

function fareHint(ride: Ride): string | undefined {
  const beforeBoardingCloses = ride.status === 'REQUESTED' || ride.status === 'MATCHED';
  if (ride.fare.ifSharedTotalPaisa !== null && beforeBoardingCloses) {
    return `Fare drops to ${taka(ride.fare.ifSharedTotalPaisa)} if someone shares your Tesla.`;
  }
  if (ride.fare.poolDiscountPaisa > 0 && beforeBoardingCloses) {
    return 'Shared fare. If your co-rider cancels before the driver arrives, it returns to the solo fare.';
  }
  return undefined;
}

export function ActiveRide({ ride, onChanged }: { ride: Ride; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Boarding closes when the driver arrives, so only these two states can still be cancelled.
  const canCancel = ride.status === 'REQUESTED' || ride.status === 'MATCHED';

  async function cancel() {
    if (!window.confirm('Cancel this ride?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelRide(ride.id);
      onChanged();
    } catch (err) {
      setError(err as Error);
      onChanged(); // the ride may have moved on (e.g. driver arrived): show the truth
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Your current ride">
      <div className="card-title">
        <h2 className="route">
          {ride.pickup.name}
          <span className="arrow">→</span>
          {ride.destination.name}
        </h2>
        <StatusPill status={ride.status} />
      </div>
      <RideSteps status={ride.status} />
      <p aria-live="polite">{statusMessage(ride)}</p>

      <FareTable fare={ride.fare} hint={fareHint(ride)} />
      <p className="small muted">
        {ride.seats} {ride.seats === 1 ? 'seat' : 'seats'} · {km(ride.distanceM)} · paying with{' '}
        {ride.paymentMethod === 'CASH' ? 'cash' : 'TeslaPay'}
      </p>

      <ErrorBanner error={error} />
      <div className="row">
        <button className="btn danger" disabled={!canCancel || busy} onClick={cancel}>
          {busy ? 'Cancelling…' : 'Cancel ride'}
        </button>
        {!canCancel && <span className="small muted">Cancelling is closed once the driver has arrived.</span>}
      </div>
      <RideTimeline key={`${ride.id}:${ride.status}:${ride.fare.totalFarePaisa}`} rideId={ride.id} />
    </section>
  );
}
