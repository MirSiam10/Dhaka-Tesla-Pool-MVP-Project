import { type Db, pool as dbPool, query, withTransaction } from '../db/pool';
import { conflict, notFound } from '../errors';
import { lockPool, lockRide, tryJoinPool, type JoinVerdict } from '../pooling/poolService';
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
