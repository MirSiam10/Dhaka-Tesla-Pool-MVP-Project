import { describe, expect, it } from 'vitest';
import { canJoinPool } from '../src/pooling/matching';

const bullet = { pickupZone: 'BANANI', corridor: 'EAST', seatCapacity: 3, occupiedSeats: 1 };

describe('matching rule', () => {
  it('lets Rafiq (Banani to Gulshan 1, EAST) join Nusrat (Banani to Mohakhali, EAST)', () => {
    expect(canJoinPool(bullet, { pickupZone: 'BANANI', destinationCorridor: 'EAST', seats: 1 })).toEqual({ ok: true });
  });

  it('rejects a different pickup zone', () => {
    expect(canJoinPool(bullet, { pickupZone: 'FARMGATE', destinationCorridor: 'EAST', seats: 1 })).toEqual({
      ok: false,
      reason: 'PICKUP_MISMATCH',
    });
  });

  it('rejects a destination in another corridor', () => {
    expect(canJoinPool(bullet, { pickupZone: 'BANANI', destinationCorridor: 'NORTH', seats: 1 })).toEqual({
      ok: false,
      reason: 'CORRIDOR_MISMATCH',
    });
  });

  it('rejects a request that does not fit the free seats', () => {
    expect(canJoinPool(bullet, { pickupZone: 'BANANI', destinationCorridor: 'EAST', seats: 3 })).toEqual({
      ok: false,
      reason: 'NO_SEATS',
    });
  });

  it('accepts exactly filling the Tesla', () => {
    expect(canJoinPool(bullet, { pickupZone: 'BANANI', destinationCorridor: 'EAST', seats: 2 })).toEqual({ ok: true });
  });
});
