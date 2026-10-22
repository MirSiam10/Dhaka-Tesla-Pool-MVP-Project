import { describe, expect, it } from 'vitest';
import {
  assertPoolTransition,
  assertRideTransition,
  canRideTransition,
  type PoolStatus,
  type RideStatus,
} from '../src/pooling/lifecycle';

const RIDE: RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'];

describe('ride state machine', () => {
  it('allows the happy path', () => {
    const path: RideStatus[] = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED'];
    for (let i = 0; i < path.length - 1; i++) expect(() => assertRideTransition(path[i], path[i + 1])).not.toThrow();
  });

  it('rejects skipping a stage', () => {
    expect(() => assertRideTransition('REQUESTED', 'STARTED')).toThrow(/cannot move from REQUESTED to STARTED/);
    expect(() => assertRideTransition('MATCHED', 'COMPLETED')).toThrow();
    expect(() => assertRideTransition('DRIVER_ARRIVED', 'COMPLETED')).toThrow();
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    for (const to of RIDE) {
      expect(canRideTransition('COMPLETED', to)).toBe(false);
      expect(canRideTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('does not allow a passenger to cancel once the trip has started', () => {
    expect(canRideTransition('STARTED', 'CANCELLED')).toBe(false);
    expect(canRideTransition('DRIVER_ARRIVED', 'CANCELLED')).toBe(false);
  });

  it('throws an AppError with a stable code', () => {
    try {
      assertRideTransition('COMPLETED', 'STARTED');
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
    }
  });
});

describe('pool state machine', () => {
  const ok: [PoolStatus, PoolStatus][] = [
    ['OPEN', 'DRIVER_ARRIVED'],
    ['DRIVER_ARRIVED', 'STARTED'],
    ['STARTED', 'COMPLETED'],
    ['OPEN', 'CANCELLED'],
  ];
  it.each(ok)('allows %s -> %s', (from, to) => expect(() => assertPoolTransition(from, to)).not.toThrow());

  const bad: [PoolStatus, PoolStatus][] = [
    ['OPEN', 'STARTED'],
    ['OPEN', 'COMPLETED'],
    ['STARTED', 'CANCELLED'],
    ['COMPLETED', 'OPEN'],
    ['CANCELLED', 'OPEN'],
  ];
  it.each(bad)('rejects %s -> %s', (from, to) => expect(() => assertPoolTransition(from, to)).toThrow());
});
