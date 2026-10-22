/**
 * Matching rule (assumption A1, docs/decisions.md):
 *
 *   A request can join a pool when
 *     1. it has the SAME PICKUP ZONE as the pool, and
 *     2. its destination zone is in the SAME CORRIDOR as the pool's corridor
 *        (the corridor of the first passenger's destination), and
 *     3. the pool has enough free seats for the seats requested.
 *
 * Nusrat (Banani to Mohakhali) and Rafiq (Banani to Gulshan 1): same pickup, both
 * destinations in the EAST corridor, so they can share Bullet.
 */
export interface PoolShape {
  pickupZone: string;
  corridor: string;
  seatCapacity: number;
  occupiedSeats: number;
}

export interface RequestShape {
  pickupZone: string;
  destinationCorridor: string;
  seats: number;
}

export type MatchVerdict = { ok: true } | { ok: false; reason: 'PICKUP_MISMATCH' | 'CORRIDOR_MISMATCH' | 'NO_SEATS' };

export function canJoinPool(pool: PoolShape, request: RequestShape): MatchVerdict {
  if (pool.pickupZone !== request.pickupZone) return { ok: false, reason: 'PICKUP_MISMATCH' };
  if (pool.corridor !== request.destinationCorridor) return { ok: false, reason: 'CORRIDOR_MISMATCH' };
  if (pool.occupiedSeats + request.seats > pool.seatCapacity) return { ok: false, reason: 'NO_SEATS' };
  return { ok: true };
}
