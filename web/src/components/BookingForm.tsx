'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { km, taka } from '@/lib/format';
import type { FareEstimate, PaymentMethod, User, Zone } from '@/lib/types';
import { ErrorBanner } from './ui';

interface Props {
  zones: Zone[];
  user: User;
  onBooked: () => void;
}

export function BookingForm({ zones, user, onBooked }: Props) {
  const [pickup, setPickup] = useState('BANANI');
  const [destination, setDestination] = useState('');
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Live price quote. The API owns the fare maths; the form only displays it.
  useEffect(() => {
    setEstimate(null);
    setEstimateError(null);
    if (!pickup || !destination || pickup === destination) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .estimate(pickup, destination, seats)
        .then((e) => !cancelled && setEstimate(e))
        .catch((e) => !cancelled && setEstimateError(e));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickup, destination, seats]);

  const walletShort = estimate !== null && user.walletPaisa < estimate.solo.totalFarePaisa;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestRide({ pickupZone: pickup, destinationZone: destination, seats, paymentMethod: payment });
      onBooked();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-title">
        <h2>Where to?</h2>
      </div>
      <div className="grid2">
        <label>
          Pickup
          <select
            value={pickup}
            onChange={(e) => {
              setPickup(e.target.value);
              if (e.target.value === destination) setDestination('');
            }}
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination
          <select value={destination} onChange={(e) => setDestination(e.target.value)} required>
            <option value="" disabled>
              Choose a zone
            </option>
            {zones
              .filter((z) => z.code !== pickup)
              .map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div>
        <span className="small muted" id="seats-label" style={{ fontWeight: 600 }}>
          Seats
        </span>
        <div className="segmented" role="group" aria-labelledby="seats-label">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" aria-pressed={seats === n} onClick={() => setSeats(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="small muted" id="pay-label" style={{ fontWeight: 600 }}>
          Pay with
        </span>
        <div className="segmented" role="group" aria-labelledby="pay-label">
          <button type="button" aria-pressed={payment === 'CASH'} onClick={() => setPayment('CASH')}>
            Cash
          </button>
          <button type="button" aria-pressed={payment === 'TESLAPAY'} onClick={() => setPayment('TESLAPAY')}>
            TeslaPay ({taka(user.walletPaisa)})
          </button>
        </div>
      </div>

      {estimate && (
        <div className="banner ok" aria-live="polite">
          {km(estimate.distanceM)}: <strong>{taka(estimate.solo.totalFarePaisa)}</strong> alone, or{' '}
          <strong>{taka(estimate.shared.totalFarePaisa)}</strong> if someone shares (save{' '}
          {taka(estimate.shared.poolDiscountPaisa)}).
        </div>
      )}
      <ErrorBanner error={estimateError} />
      {walletShort && payment === 'TESLAPAY' && (
        <div className="banner warn">TeslaPay balance is below the solo fare. Pay with cash instead.</div>
      )}
      <ErrorBanner error={error} />

      <button className="btn primary block" type="submit" disabled={busy || !destination || (walletShort && payment === 'TESLAPAY')}>
        {busy ? 'Finding your Tesla…' : 'Request a Tesla'}
      </button>
    </form>
  );
}
