import type { PoolStatus, RideStatus } from './types';

/** Integer paisa to a taka string: 5600 -> "৳56", 5650 -> "৳56.50". Money is never a float in state. */
export function taka(paisa: number): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}৳${whole}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`;
}

export function km(distanceM: number): string {
  return `${distanceM / 1000} km`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  REQUESTED: 'Looking for a Tesla',
  MATCHED: 'Tesla assigned',
  DRIVER_ARRIVED: 'Driver at pickup',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const POOL_STATUS_LABEL: Record<PoolStatus, string> = {
  OPEN: 'Boarding open',
  DRIVER_ARRIVED: 'At pickup',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ACTIVE_RIDE_STATUSES: RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

/** Why a driver cannot accept a waiting request right now (codes from the API's matching rule). */
export const REASON_TEXT: Record<string, string> = {
  OFFLINE: 'Go online to accept',
  PICKUP_MISMATCH: 'Different pickup zone than your pool',
  CORRIDOR_MISMATCH: 'Destination is off your pool’s corridor',
  NO_SEATS: 'Not enough free seats',
  POOL_CLOSED: 'Boarding is closed for your pool',
};

export const EVENT_LABEL: Record<string, string> = {
  RIDE_REQUESTED: 'Ride requested',
  RIDE_MATCHED: 'Matched to a Tesla',
  FARE_CHANGED: 'Fare updated',
  RIDE_DRIVER_ARRIVED: 'Driver arrived',
  RIDE_STARTED: 'Trip started',
  RIDE_COMPLETED: 'Dropped off',
  RIDE_CANCELLED: 'Ride cancelled',
  RIDE_REQUEUED: 'Tesla cancelled, back in the queue',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_FELL_BACK_TO_CASH: 'Wallet short, paid in cash',
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
