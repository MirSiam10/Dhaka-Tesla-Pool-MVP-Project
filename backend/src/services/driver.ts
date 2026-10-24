import { type Db, pool as dbPool, query, withTransaction } from '../db/pool';
import { conflict, notFound } from '../errors';
import { assertPoolTransition, assertRideTransition, type RideStatus } from '../pooling/lifecycle';
import { leavePool, lockPool, lockRide, tryJoinPool, type JoinVerdict, type PoolRow } from '../pooling/poolService';
import { canJoinPool } from '../pooling/matching';
import { recordEvent } from './events';

export interface VehicleRow {
  id: string;
  driver_id: string;
  name: string;
  plate: string;
  capacity: number;
  is_online: boolean;
}

export interface PoolPassengerView {
  rideId: string;
  passengerName: string;
  seats: number;
  status: string;
  pickup: { code: string; name: string };
  destination: { code: string; name: string };
  farePaisa: number;
  poolDiscountPaisa: number;
  paymentMethod: string;
}

/** The driver's view of one trip: who is aboard, which seats, and what stage it is at. */
export interface PoolView {
  id: string;
  status: string;
  pickup: { code: string; name: string };
  corridor: string;
  seatCapacity: number;
  occupiedSeats: number;
  freeSeats: number;
  vehicle: { name: string; plate: string };
  passengers: PoolPassengerView[];
  totalFarePaisa: number;
  createdAt: string;
  completedAt: string | null;
}

const ACTIVE_POOL = "('OPEN', 'DRIVER_ARRIVED', 'STARTED')";

export async function getVehicle(db: Db, driverId: string, lock = false): Promise<VehicleRow> {
  const { rows } = await db.query(`SELECT * FROM vehicles WHERE driver_id = $1 ${lock ? 'FOR UPDATE' : ''}`, [driverId]);
  if (!rows[0]) throw notFound('No Tesla is registered for this driver');
  return rows[0];
}

export async function getProfile(driverId: string) {
  const v = await getVehicle(dbPool, driverId);
  const active = await getActivePoolView(dbPool, driverId);
  return {
    vehicle: { id: v.id, name: v.name, plate: v.plate, capacity: v.capacity },
    online: v.is_online,
    activePool: active,
  };
}

/** Going offline is refused while a pool is live, so passengers are never stranded (A9). */
export async function setOnline(driverId: string, online: boolean) {
  return withTransaction(async (db) => {
    const v = await getVehicle(db, driverId, true);
    if (!online) {
      const { rows } = await db.query(`SELECT 1 FROM pools WHERE vehicle_id = $1 AND status IN ${ACTIVE_POOL}`, [v.id]);
      if (rows[0]) throw conflict('ACTIVE_POOL_EXISTS', 'Finish or cancel your current pool before going offline');
    }
    await db.query('UPDATE vehicles SET is_online = $2 WHERE id = $1', [v.id, online]);
    return { online };
  });
}

const POOL_REASON_TEXT: Record<string, string> = {
  PICKUP_MISMATCH: 'This request starts in a different zone than your current pool',
  CORRIDOR_MISMATCH: "This request's destination is not on your pool's corridor",
  NO_SEATS: 'Not enough free seats in your Tesla',
  POOL_CLOSED: 'Boarding has closed for your current pool',
};

function joinFailure(verdict: Extract<JoinVerdict, { ok: false }>) {
  return conflict('CANNOT_POOL', POOL_REASON_TEXT[verdict.reason] ?? 'Cannot pool this request', { reason: verdict.reason });
}

export interface OpenRequestView {
  rideId: string;
  passengerName: string;
  seats: number;
  pickup: { code: string; name: string };
  destination: { code: string; name: string };
  farePaisa: number;
  requestedAt: string;
  canAccept: boolean;
  reason: string | null;
}

/** Waiting requests (oldest first), each flagged with whether THIS driver can take it right now. */
export async function listOpenRequests(driverId: string, zone?: string): Promise<OpenRequestView[]> {
  const vehicle = await getVehicle(dbPool, driverId);
  const active = await query(`SELECT * FROM pools WHERE vehicle_id = $1 AND status IN ${ACTIVE_POOL}`, [vehicle.id]);
  const current = active.rows[0];

  const { rows } = await query(
    `SELECT r.id, r.seats, r.pickup_zone, pz.name AS pickup_name, r.destination_zone, dz.name AS destination_name,
            dz.corridor, r.total_fare_paisa, r.created_at, u.name AS passenger_name
       FROM ride_requests r
       JOIN users u ON u.id = r.passenger_id
       JOIN zones pz ON pz.code = r.pickup_zone
       JOIN zones dz ON dz.code = r.destination_zone
      WHERE r.status = 'REQUESTED' AND ($1::text IS NULL OR r.pickup_zone = $1)
      ORDER BY r.created_at, r.id
      LIMIT 50`,
    [zone ?? null],
  );

  return rows.map((r) => {
    let reason: string | null = null;
    if (!vehicle.is_online) reason = 'OFFLINE';
    else if (r.seats > vehicle.capacity) reason = 'NO_SEATS';
    else if (current) {
      if (current.status !== 'OPEN') reason = 'POOL_CLOSED';
      else {
        const verdict = canJoinPool(
          { pickupZone: current.pickup_zone, corridor: current.corridor, seatCapacity: current.seat_capacity, occupiedSeats: current.occupied_seats },
          { pickupZone: r.pickup_zone, destinationCorridor: r.corridor, seats: r.seats },
        );
        if (!verdict.ok) reason = verdict.reason;
      }
    }
    return {
      rideId: r.id,
      passengerName: r.passenger_name,
      seats: r.seats,
      pickup: { code: r.pickup_zone, name: r.pickup_name },
      destination: { code: r.destination_zone, name: r.destination_name },
      farePaisa: r.total_fare_paisa,
      requestedAt: r.created_at.toISOString(),
      canAccept: reason === null,
      reason,
    };
  });
}

/**
 * Driver accepts a waiting request.
 *  - No live pool: opens one at the request's pickup zone (the request fixes the corridor).
 *  - Live OPEN pool: the request must satisfy the matching rule and fit the free seats.
 * Locks are taken vehicle -> pool -> ride. Locking the vehicle first serialises one driver's
 * own double taps; locking the ride last makes "two drivers accept the same ride" safe: the
 * second sees it is no longer REQUESTED and gets a 409.
 */
export async function acceptRide(driverId: string, rideId: string): Promise<PoolView> {
  return withTransaction(async (db) => {
    const vehicle = await getVehicle(db, driverId, true);
    if (!vehicle.is_online) throw conflict('DRIVER_OFFLINE', 'Go online before accepting rides');

    const live = await db.query(`SELECT id FROM pools WHERE vehicle_id = $1 AND status IN ${ACTIVE_POOL}`, [vehicle.id]);
    let poolRow = live.rows[0] ? await lockPool(db, live.rows[0].id) : null;
    if (poolRow && poolRow.status !== 'OPEN') {
      throw conflict('POOL_CLOSED', 'Boarding has closed for your current pool. Finish the trip first.');
    }

    const ride = await lockRide(db, rideId);
    if (ride.status !== 'REQUESTED') {
      throw conflict('RIDE_NOT_AVAILABLE', 'That request was cancelled or taken by another driver');
    }

    if (!poolRow) {
      const created = await db.query(
        `INSERT INTO pools (vehicle_id, pickup_zone, corridor, seat_capacity)
         VALUES ($1, $2, $3, $4)
         RETURNING id, vehicle_id, pickup_zone, corridor, status, seat_capacity, occupied_seats`,
        [vehicle.id, ride.pickup_zone, ride.destination_corridor, vehicle.capacity],
      );
      poolRow = created.rows[0];
      await recordEvent(db, {
        poolId: poolRow!.id,
        actorId: driverId,
        type: 'POOL_OPENED',
        to: 'OPEN',
        metadata: { vehicle: vehicle.name, pickup: ride.pickup_zone, corridor: ride.destination_corridor },
      });
    }

    const verdict = await tryJoinPool(db, poolRow!, ride, driverId, 'driver_accept');
    if (!verdict.ok) throw joinFailure(verdict);
    return (await getPoolView(db, poolRow!.id))!;
  });
}

export async function getPoolView(db: Db, poolId: string): Promise<PoolView | null> {
  const p = await db.query(
    `SELECT p.*, pz.name AS pickup_name, v.name AS vehicle_name, v.plate AS vehicle_plate
       FROM pools p JOIN zones pz ON pz.code = p.pickup_zone JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.id = $1`,
    [poolId],
  );
  const pool = p.rows[0];
  if (!pool) return null;

  const r = await db.query(
    `SELECT r.id, r.status, r.seats, r.total_fare_paisa, r.pool_discount_paisa, r.payment_method,
            r.pickup_zone, pz.name AS pickup_name, r.destination_zone, dz.name AS destination_name, u.name AS passenger_name
       FROM ride_requests r
       JOIN users u ON u.id = r.passenger_id
       JOIN zones pz ON pz.code = r.pickup_zone
       JOIN zones dz ON dz.code = r.destination_zone
      WHERE r.pool_id = $1 AND r.status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED')
      ORDER BY r.matched_at, r.id`,
    [poolId],
  );
  const passengers: PoolPassengerView[] = r.rows.map((x) => ({
    rideId: x.id,
    passengerName: x.passenger_name,
    seats: x.seats,
    status: x.status,
    pickup: { code: x.pickup_zone, name: x.pickup_name },
    destination: { code: x.destination_zone, name: x.destination_name },
    farePaisa: x.total_fare_paisa,
    poolDiscountPaisa: x.pool_discount_paisa,
    paymentMethod: x.payment_method,
  }));

  return {
    id: pool.id,
    status: pool.status,
    pickup: { code: pool.pickup_zone, name: pool.pickup_name },
    corridor: pool.corridor,
    seatCapacity: pool.seat_capacity,
    occupiedSeats: pool.occupied_seats,
    freeSeats: pool.seat_capacity - pool.occupied_seats,
    vehicle: { name: pool.vehicle_name, plate: pool.vehicle_plate },
    passengers,
    totalFarePaisa: passengers.reduce((sum, x) => sum + x.farePaisa, 0),
    createdAt: pool.created_at.toISOString(),
    completedAt: pool.completed_at ? pool.completed_at.toISOString() : null,
  };
}

export async function getActivePoolView(db: Db, driverId: string): Promise<PoolView | null> {
  const v = await getVehicle(db, driverId);
  const { rows } = await db.query(`SELECT id FROM pools WHERE vehicle_id = $1 AND status IN ${ACTIVE_POOL}`, [v.id]);
  return rows[0] ? getPoolView(db, rows[0].id) : null;
}

// ---------------------------------------------------------------------------------------------
// Trip lifecycle. Arrive and start act on the whole pool; completion is per passenger because
// Nusrat gets off at Mohakhali while Rafiq rides on to Gulshan 1.
// ---------------------------------------------------------------------------------------------

/** Locks the driver's live pool (vehicle -> pool) or explains why there is none. */
async function lockActivePool(db: Db, driverId: string): Promise<PoolRow> {
  const vehicle = await getVehicle(db, driverId, true);
  const { rows } = await db.query(`SELECT id FROM pools WHERE vehicle_id = $1 AND status IN ${ACTIVE_POOL}`, [vehicle.id]);
  if (!rows[0]) throw conflict('NO_ACTIVE_POOL', 'You have no active pool. Accept a request first.');
  return lockPool(db, rows[0].id);
}

/** Locks every ride in the pool in a fixed order (by id) so concurrent actors cannot deadlock. */
async function lockPoolRides(db: Db, poolId: string, statuses: RideStatus[]) {
  const { rows } = await db.query(
    `SELECT id, status, passenger_id FROM ride_requests
      WHERE pool_id = $1 AND status = ANY($2::text[]) ORDER BY id FOR UPDATE`,
    [poolId, statuses],
  );
  return rows as { id: string; status: RideStatus; passenger_id: string }[];
}

async function advancePool(
  db: Db,
  driverId: string,
  to: 'DRIVER_ARRIVED' | 'STARTED',
  rideFrom: RideStatus,
  eventType: string,
  timestampColumn: 'arrived_at' | 'started_at',
): Promise<PoolView> {
  const pool = await lockActivePool(db, driverId);
  assertPoolTransition(pool.status, to); // OPEN -> DRIVER_ARRIVED -> STARTED only, in order

  const rides = await lockPoolRides(db, pool.id, [rideFrom]);
  for (const r of rides) assertRideTransition(r.status, to);
  await db.query(
    `UPDATE ride_requests SET status = $2, ${timestampColumn} = now() WHERE pool_id = $1 AND status = $3`,
    [pool.id, to, rideFrom],
  );
  await db.query(`UPDATE pools SET status = $2, ${timestampColumn} = now() WHERE id = $1`, [pool.id, to]);

  await recordEvent(db, { poolId: pool.id, actorId: driverId, type: `POOL_${eventType}`, from: pool.status, to });
  for (const r of rides) {
    await recordEvent(db, { rideId: r.id, poolId: pool.id, actorId: driverId, type: `RIDE_${eventType}`, from: r.status, to });
  }
  return (await getPoolView(db, pool.id))!;
}

/**
 * Driver reached the pickup. Boarding closes here: from now on nobody can join or cancel,
 * so pool membership, and therefore every fare, is final.
 */
export function markArrived(driverId: string): Promise<PoolView> {
  return withTransaction((db) => advancePool(db, driverId, 'DRIVER_ARRIVED', 'MATCHED', 'DRIVER_ARRIVED', 'arrived_at'));
}

export function startTrip(driverId: string): Promise<PoolView> {
  return withTransaction((db) => advancePool(db, driverId, 'STARTED', 'DRIVER_ARRIVED', 'STARTED', 'started_at'));
}

/**
 * Drops one passenger off. Records the payment, and completes the pool once the last
 * passenger is done. TeslaPay is a simulated wallet debit; if the wallet cannot cover it
 * (it should, since it covered the solo fare at request time) the fare falls back to cash
 * instead of leaving the trip stuck.
 */
export async function completePassenger(driverId: string, rideId: string): Promise<PoolView> {
  return withTransaction(async (db) => {
    const pool = await lockActivePool(db, driverId);
    const ride = await lockRide(db, rideId);
    if (ride.pool_id !== pool.id) throw notFound('That ride is not in your pool');
    if (pool.status !== 'STARTED') throw conflict('INVALID_TRANSITION', `The trip has not started (pool is ${pool.status})`);
    assertRideTransition(ride.status as RideStatus, 'COMPLETED');

    await db.query("UPDATE ride_requests SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [ride.id]);
    await db.query('UPDATE pools SET occupied_seats = occupied_seats - $2 WHERE id = $1', [pool.id, ride.seats]);
    await recordEvent(db, { rideId: ride.id, poolId: pool.id, actorId: driverId, type: 'RIDE_COMPLETED', from: 'STARTED', to: 'COMPLETED' });

    let method: 'CASH' | 'TESLAPAY' = ride.payment_method;
    if (method === 'TESLAPAY') {
      const debit = await db.query(
        'UPDATE users SET wallet_paisa = wallet_paisa - $2 WHERE id = $1 AND wallet_paisa >= $2',
        [ride.passenger_id, ride.total_fare_paisa],
      );
      if (debit.rowCount === 0) {
        method = 'CASH';
        await recordEvent(db, { rideId: ride.id, poolId: pool.id, actorId: driverId, type: 'PAYMENT_FELL_BACK_TO_CASH', metadata: { amountPaisa: ride.total_fare_paisa } });
      }
    }
    await db.query('INSERT INTO payments (ride_request_id, method, amount_paisa) VALUES ($1, $2, $3)', [ride.id, method, ride.total_fare_paisa]);
    await recordEvent(db, { rideId: ride.id, poolId: pool.id, actorId: driverId, type: 'PAYMENT_RECORDED', metadata: { method, amountPaisa: ride.total_fare_paisa } });

    const { rows } = await db.query("SELECT count(*)::int AS n FROM ride_requests WHERE pool_id = $1 AND status = 'STARTED'", [pool.id]);
    if (rows[0].n === 0) {
      await db.query("UPDATE pools SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [pool.id]);
      await recordEvent(db, { poolId: pool.id, actorId: driverId, type: 'POOL_COMPLETED', from: 'STARTED', to: 'COMPLETED' });
    }
    return (await getPoolView(db, pool.id))!;
  });
}

/**
 * Driver abandons the pool before the trip starts. Nobody is cancelled: every passenger goes
 * back to REQUESTED at their solo fare so another Tesla can pick them up.
 */
export async function cancelPool(driverId: string): Promise<{ requeuedRides: number }> {
  return withTransaction(async (db) => {
    const pool = await lockActivePool(db, driverId);
    assertPoolTransition(pool.status, 'CANCELLED'); // rejects STARTED

    const rides = await lockPoolRides(db, pool.id, ['MATCHED', 'DRIVER_ARRIVED']);
    for (const r of rides) {
      const locked = await lockRide(db, r.id);
      assertRideTransition(locked.status as RideStatus, 'REQUESTED');
      // The last passenger out also cancels the (now empty) pool; see leavePool.
      await leavePool(db, pool, locked, driverId, 'REQUESTED');
    }
    return { requeuedRides: rides.length };
  });
}

export async function history(driverId: string): Promise<{ pools: PoolView[]; completedTrips: number; earningsPaisa: number }> {
  const v = await getVehicle(dbPool, driverId);
  const { rows } = await query(
    "SELECT id FROM pools WHERE vehicle_id = $1 AND status IN ('COMPLETED', 'CANCELLED') ORDER BY created_at DESC LIMIT 20",
    [v.id],
  );
  const pools = (await Promise.all(rows.map((r) => getPoolView(dbPool, r.id)))).filter((p): p is PoolView => p !== null);
  const earned = await query(
    `SELECT count(*)::int AS trips, COALESCE(sum(py.amount_paisa), 0)::int AS total
       FROM payments py JOIN ride_requests r ON r.id = py.ride_request_id
       JOIN pools p ON p.id = r.pool_id WHERE p.vehicle_id = $1`,
    [v.id],
  );
  return { pools, completedTrips: earned.rows[0].trips, earningsPaisa: earned.rows[0].total };
}
