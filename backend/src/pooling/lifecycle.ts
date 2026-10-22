import { conflict } from '../errors';

export type RideStatus = 'REQUESTED' | 'MATCHED' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type PoolStatus = 'OPEN' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';

/**
 * The only legal moves. Anything not listed here is rejected with 409 INVALID_TRANSITION,
 * so a bug or a hostile client cannot, say, complete a ride that never started.
 *
 * MATCHED/DRIVER_ARRIVED -> REQUESTED happens when the driver abandons the pool
 * before the trip starts: passengers go back to waiting instead of being cancelled.
 */
const RIDE_TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  REQUESTED: ['MATCHED', 'CANCELLED'],
  MATCHED: ['DRIVER_ARRIVED', 'CANCELLED', 'REQUESTED'],
  DRIVER_ARRIVED: ['STARTED', 'REQUESTED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const POOL_TRANSITIONS: Record<PoolStatus, readonly PoolStatus[]> = {
  OPEN: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['STARTED', 'CANCELLED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];
/** Rides that hold seats in a pool. */
export const SEAT_HOLDING_STATUSES: readonly RideStatus[] = ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export const canRideTransition = (from: RideStatus, to: RideStatus) => RIDE_TRANSITIONS[from].includes(to);
export const canPoolTransition = (from: PoolStatus, to: PoolStatus) => POOL_TRANSITIONS[from].includes(to);

export function assertRideTransition(from: RideStatus, to: RideStatus): void {
  if (!canRideTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `A ride cannot move from ${from} to ${to}`, { from, to });
  }
}

export function assertPoolTransition(from: PoolStatus, to: PoolStatus): void {
  if (!canPoolTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `A pool cannot move from ${from} to ${to}`, { from, to });
  }
}
