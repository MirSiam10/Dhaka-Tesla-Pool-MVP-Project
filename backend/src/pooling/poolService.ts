import type { Db } from '../db/pool';
import { notFound } from '../errors';
import { calculateFare } from '../fare/fare';
import { recordEvent } from '../services/events';
import { canJoinPool, type MatchVerdict } from './matching';

/**
 * Pool operations. Every function takes a transaction client and assumes the caller has
 * already locked the rows it passes in. Lock order, everywhere in the codebase:
 *
 *     vehicle (driver only)  ->  pool  ->  ride request(s)
 *
 * A single global order is what prevents deadlocks. The pool row is the serialisation
 * point for a Tesla: whoever holds `FOR UPDATE` on it is the only one changing its seats.
 */

export interface PoolRow {
  id: string;
  vehicle_id: string;
  pickup_zone: string;
  corridor: string;
  status: 'OPEN' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
  seat_capacity: number;
  occupied_seats: number;
}

export interface LockedRide {
  id: string;
  passenger_id: string;
  pool_id: string | null;
  pickup_zone: string;
  destination_zone: string;
  destination_corridor: string;
  seats: number;
  status: string;
  total_fare_paisa: number;
  pool_discount_paisa: number;
}

export type JoinVerdict = MatchVerdict | { ok: false; reason: 'POOL_CLOSED' };

export async function lockPool(db: Db, poolId: string): Promise<PoolRow> {
  const { rows } = await db.query(
    `SELECT id, vehicle_id, pickup_zone, corridor, status, seat_capacity, occupied_seats
       FROM pools WHERE id = $1 FOR UPDATE`,
    [poolId],
  );
  if (!rows[0]) throw notFound('Pool not found');
  return rows[0];
}

export async function lockRide(db: Db, rideId: string): Promise<LockedRide> {
  const { rows } = await db.query(
    `SELECT r.id, r.passenger_id, r.pool_id, r.pickup_zone, r.destination_zone, r.seats, r.status,
            r.total_fare_paisa, r.pool_discount_paisa, dz.corridor AS destination_corridor
       FROM ride_requests r JOIN zones dz ON dz.code = r.destination_zone
      WHERE r.id = $1 FOR UPDATE OF r`,
    [rideId],
  );
  if (!rows[0]) throw notFound('Ride not found');
  return rows[0];
}

/**
 * Tries to seat `ride` in `pool`. Both rows must already be locked (pool first).
 *
 * The seat check happens twice on purpose:
 *  1. `canJoinPool` explains WHY a join is refused (wrong zone, wrong corridor, full).
 *  2. The conditional UPDATE is the authoritative check. It runs under the pool's row lock,
 *     and the CHECK constraint on pools.occupied_seats is a final backstop if code ever regresses.
 */
export async function tryJoinPool(
  db: Db,
  pool: PoolRow,
  ride: LockedRide,
  actorId: string,
  via: 'auto_join' | 'driver_accept',
): Promise<JoinVerdict> {
  if (pool.status !== 'OPEN') return { ok: false, reason: 'POOL_CLOSED' };

  const verdict = canJoinPool(
    {
      pickupZone: pool.pickup_zone,
      corridor: pool.corridor,
      seatCapacity: pool.seat_capacity,
      occupiedSeats: pool.occupied_seats,
    },
    { pickupZone: ride.pickup_zone, destinationCorridor: ride.destination_corridor, seats: ride.seats },
  );
  if (!verdict.ok) return verdict;

  const updated = await db.query(
    `UPDATE pools SET occupied_seats = occupied_seats + $2
      WHERE id = $1 AND status = 'OPEN' AND occupied_seats + $2 <= seat_capacity`,
    [pool.id, ride.seats],
  );
  if (updated.rowCount === 0) return { ok: false, reason: 'NO_SEATS' };

  await db.query(
    "UPDATE ride_requests SET status = 'MATCHED', pool_id = $2, matched_at = now() WHERE id = $1",
    [ride.id, pool.id],
  );
  await recordEvent(db, {
    rideId: ride.id,
    poolId: pool.id,
    actorId,
    type: 'RIDE_MATCHED',
    from: 'REQUESTED',
    to: 'MATCHED',
    metadata: { via, seats: ride.seats },
  });
  await repricePool(db, pool.id, actorId);
  return { ok: true };
}

/**
 * Called for a freshly requested ride: is there an OPEN pool it can join right now?
 * Candidates are found without locks (cheap, uses pools_open_match_idx) and then each is
 * locked and re-checked, because the unlocked read may already be stale.
 */
export async function autoJoin(db: Db, ride: LockedRide, actorId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT p.id
       FROM pools p JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.status = 'OPEN' AND v.is_online
        AND p.pickup_zone = $1 AND p.corridor = $2
        AND p.occupied_seats + $3 <= p.seat_capacity
      ORDER BY p.created_at, p.id
      LIMIT 5`,
    [ride.pickup_zone, ride.destination_corridor, ride.seats],
  );
  for (const candidate of rows) {
    const pool = await lockPool(db, candidate.id);
    if ((await tryJoinPool(db, pool, ride, actorId, 'auto_join')).ok) return pool.id;
  }
  return null;
}

/**
 * Recomputes every waiting passenger's fare from the current membership: the pool discount
 * applies to everyone when 2+ passengers share, and to nobody when only one is left.
 * Only MATCHED rides are repriced. Once the driver arrives membership is frozen, so fares are final.
 */
export async function repricePool(db: Db, poolId: string, actorId: string | null): Promise<void> {
  const { rows } = await db.query(
    `SELECT r.id, r.seats, r.pool_discount_paisa, r.total_fare_paisa, zd.distance_m
       FROM ride_requests r
       JOIN zone_distances zd
         ON zd.zone_a = LEAST(r.pickup_zone, r.destination_zone)
        AND zd.zone_b = GREATEST(r.pickup_zone, r.destination_zone)
      WHERE r.pool_id = $1 AND r.status = 'MATCHED'
      ORDER BY r.id`,
    [poolId],
  );
  const shared = rows.length >= 2;
  for (const r of rows) {
    const fare = calculateFare({ distanceM: r.distance_m, seats: r.seats, shared });
    if (fare.totalFarePaisa === r.total_fare_paisa) continue;
    await db.query(
      `UPDATE ride_requests
          SET base_fare_paisa = $2, distance_charge_paisa = $3, pool_discount_paisa = $4, total_fare_paisa = $5
        WHERE id = $1`,
      [r.id, fare.baseFarePaisa, fare.distanceChargePaisa, fare.poolDiscountPaisa, fare.totalFarePaisa],
    );
    await recordEvent(db, {
      rideId: r.id,
      poolId,
      actorId,
      type: 'FARE_CHANGED',
      metadata: { fromPaisa: r.total_fare_paisa, toPaisa: fare.totalFarePaisa, sharedBy: rows.length },
    });
  }
}

/**
 * Takes a passenger out of a pool before the trip starts and releases their seats.
 *  - `to = 'CANCELLED'`: the passenger cancelled.
 *  - `to = 'REQUESTED'`: the driver abandoned the pool and the passenger goes back to waiting.
 * Pool and ride must already be locked. If nobody is left the pool is cancelled, which frees
 * the Tesla for a new pool; otherwise the remaining passengers are repriced.
 */
export async function leavePool(
  db: Db,
  pool: PoolRow,
  ride: LockedRide,
  actorId: string,
  to: 'CANCELLED' | 'REQUESTED',
): Promise<void> {
  const from = ride.status;
  if (to === 'CANCELLED') {
    await db.query("UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [ride.id]);
  } else {
    // Back to the queue at the solo fare; the pool link must be cleared (table CHECK).
    const { rows } = await db.query(
      `SELECT zd.distance_m FROM zone_distances zd
        WHERE zd.zone_a = LEAST($1::text, $2::text) AND zd.zone_b = GREATEST($1::text, $2::text)`,
      [ride.pickup_zone, ride.destination_zone],
    );
    const solo = calculateFare({ distanceM: rows[0].distance_m, seats: ride.seats, shared: false });
    await db.query(
      `UPDATE ride_requests
          SET status = 'REQUESTED', pool_id = NULL, matched_at = NULL, arrived_at = NULL,
              base_fare_paisa = $2, distance_charge_paisa = $3, pool_discount_paisa = 0, total_fare_paisa = $4
        WHERE id = $1`,
      [ride.id, solo.baseFarePaisa, solo.distanceChargePaisa, solo.totalFarePaisa],
    );
  }
  await db.query('UPDATE pools SET occupied_seats = occupied_seats - $2 WHERE id = $1', [pool.id, ride.seats]);
  await recordEvent(db, {
    rideId: ride.id,
    poolId: pool.id,
    actorId,
    type: to === 'CANCELLED' ? 'RIDE_CANCELLED' : 'RIDE_REQUEUED',
    from,
    to,
    metadata: { releasedSeats: ride.seats },
  });

  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM ride_requests WHERE pool_id = $1 AND status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED')",
    [pool.id],
  );
  if (rows[0].n === 0) {
    await db.query("UPDATE pools SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [pool.id]);
    await recordEvent(db, { poolId: pool.id, actorId, type: 'POOL_CANCELLED', from: pool.status, to: 'CANCELLED', metadata: { reason: 'no passengers left' } });
  } else {
    await repricePool(db, pool.id, actorId);
  }
}
