import type { ReactNode } from 'react';
import { POOL_STATUS_LABEL, RIDE_STATUS_LABEL, taka } from '@/lib/format';
import type { FareBreakdown, PoolStatus, RideStatus } from '@/lib/types';

export function StatusPill({ status, kind = 'ride' }: { status: RideStatus | PoolStatus; kind?: 'ride' | 'pool' }) {
  const label =
    kind === 'pool' ? POOL_STATUS_LABEL[status as PoolStatus] : RIDE_STATUS_LABEL[status as RideStatus];
  return <span className={`pill ${status.toLowerCase()}`}>{label ?? status}</span>;
}

export function ErrorBanner({ error }: { error: Error | string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      {typeof error === 'string' ? error : error.message}
    </div>
  );
}

export function Notice({ tone = 'ok', children }: { tone?: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role="status">
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p>
        <strong>{title}</strong>
      </p>
      {hint && <p className="small">{hint}</p>}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/** Itemised fare so the passenger (and an evaluator) can verify it by hand. */
export function FareTable({ fare, hint }: { fare: FareBreakdown; hint?: ReactNode }) {
  return (
    <div>
      <table className="fare">
        <tbody>
          <tr>
            <td>Base fare</td>
            <td>{taka(fare.baseFarePaisa)}</td>
          </tr>
          <tr>
            <td>Distance charge</td>
            <td>{taka(fare.distanceChargePaisa)}</td>
          </tr>
          {fare.poolDiscountPaisa > 0 && (
            <tr className="discount">
              <td>Pool discount (20%)</td>
              <td>{taka(-fare.poolDiscountPaisa)}</td>
            </tr>
          )}
          <tr className="total">
            <td>Your fare</td>
            <td>{taka(fare.totalFarePaisa)}</td>
          </tr>
        </tbody>
      </table>
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

export function SeatMeter({ capacity, taken, label }: { capacity: number; taken: number; label?: string }) {
  return (
    <div className="seats" role="img" aria-label={label ?? `${taken} of ${capacity} seats taken`}>
      {Array.from({ length: capacity }, (_, i) => (
        <span key={i} className={`seat ${i < taken ? 'taken' : ''}`}>
          {i + 1}
        </span>
      ))}
    </div>
  );
}

const STEPS: { status: RideStatus; label: string }[] = [
  { status: 'REQUESTED', label: 'Requested' },
  { status: 'MATCHED', label: 'Matched' },
  { status: 'DRIVER_ARRIVED', label: 'At pickup' },
  { status: 'STARTED', label: 'On the way' },
  { status: 'COMPLETED', label: 'Done' },
];

export function RideSteps({ status }: { status: RideStatus }) {
  const index = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="steps" aria-label="Ride progress">
      {STEPS.map((s, i) => (
        <li
          key={s.status}
          className={i < index || status === 'COMPLETED' ? 'done' : i === index ? 'done current' : ''}
          aria-current={i === index ? 'step' : undefined}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
