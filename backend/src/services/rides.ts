import { type Db, pool, query, withTransaction } from '../db/pool';
import { AppError, badRequest, conflict, notFound } from '../errors';
import { calculateFare } from '../fare/fare';
import { assertRideTransition, type RideStatus } from '../pooling/lifecycle';
import { autoJoin, leavePool, lockPool, lockRide } from '../pooling/poolService';
import { recordEvent } from './events';
import { getDistanceM, getZone } from './zones';

export type PaymentMethod = 'CASH' | 'TESLAPAY';

export interface RideInput {
  pickupZone: string;
  destinationZone: string;
  seats: number;
  paymentMethod: PaymentMethod;
}

/**
 * Passenger-facing ride. Deliberately contains no other passenger's name, id or fare:
 * a shared ride only reveals how many others are aboard (assumption A10).
 */
export interface RideView {
  id: string;
  status: RideStatus;
  seats: number;
  paymentMethod: PaymentMethod;
  pickup: { code: string; name: string };
  destination: { code: string; name: string };
  distanceM: number;
  fare: {
    baseFarePaisa: number;
    distanceChargePaisa: number;
    poolDiscountPaisa: number;
    totalFarePaisa: number;
    /** What the fare drops to if someone shares. Null once a discount applies or the trip is over. */
    ifSharedTotalPaisa: number | null;
  };
  pool: null | {
    id: string;
    status: string;
    vehicleName: string;
    vehiclePlate: string;
    driverName: string;
    coPassengers: number;
  };
  timestamps: Record<'requestedAt' | 'matchedAt' | 'arrivedAt' | 'startedAt' | 'completedAt' | 'cancelledAt', string | null>;
}

export const RIDE_VIEW_SQL = `
  SELECT r.id, r.status, r.seats, r.payment_method, r.pool_id,
         r.pickup_zone, pz.name AS pickup_name,
         r.destination_zone, dz.name AS destination_name,
         zd.distance_m,
         r.base_fare_paisa, r.distance_charge_paisa, r.pool_discount_paisa, r.total_fare_paisa,
         r.created_at, r.matched_at, r.arrived_at, r.started_at, r.completed_at, r.cancelled_at,
         p.status AS pool_status, v.name AS vehicle_name, v.plate AS vehicle_plate, d.name AS driver_name,
         (SELECT count(*)::int FROM ride_requests o
           WHERE o.pool_id = r.pool_id AND o.id <> r.id
             AND o.status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED')) AS co_passengers
    FROM ride_requests r
    JOIN zones pz ON pz.code = r.pickup_zone
    JOIN zones dz ON dz.code = r.destination_zone
    JOIN zone_distances zd
      ON zd.zone_a = LEAST(r.pickup_zone, r.destination_zone)
     AND zd.zone_b = GREATEST(r.pickup_zone, r.destination_zone)
    LEFT JOIN pools p ON p.id = r.pool_id
    LEFT JOIN vehicles v ON v.id = p.vehicle_id
    LEFT JOIN users d ON d.id = v.driver_id`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toView(r: any): RideView {
  const beforeTrip = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'].includes(r.status);
  const ifShared =
    beforeTrip && r.pool_discount_paisa === 0
      ? calculateFare({ distanceM: r.distance_m, seats: r.seats, shared: true }).totalFarePaisa
      : null;
  return {
    id: r.id,
    status: r.status,
    seats: r.seats,
    paymentMethod: r.payment_method,
    pickup: { code: r.pickup_zone, name: r.pickup_name },
    destination: { code: r.destination_zone, name: r.destination_name },
    distanceM: r.distance_m,
    fare: {
      baseFarePaisa: r.base_fare_paisa,
      distanceChargePaisa: r.distance_charge_paisa,
      poolDiscountPaisa: r.pool_discount_paisa,
      totalFarePaisa: r.total_fare_paisa,
      ifSharedTotalPaisa: ifShared,
    },
    pool: r.pool_id
      ? {
          id: r.pool_id,
          status: r.pool_status,
          vehicleName: r.vehicle_name,
          vehiclePlate: r.vehicle_plate,
          driverName: r.driver_name,
          coPassengers: r.co_passengers,
        }
      : null,
    timestamps: {
      requestedAt: iso(r.created_at),
      matchedAt: iso(r.matched_at),
      arrivedAt: iso(r.arrived_at),
      startedAt: iso(r.started_at),
      completedAt: iso(r.completed_at),
      cancelledAt: iso(r.cancelled_at),
    },
  };
}

/** Loads one ride, but only if it belongs to the passenger. Someone else's ride is a 404. */
export async function getRideForPassenger(db: Db, passengerId: string, rideId: string): Promise<RideView> {
  const { rows } = await db.query(`${RIDE_VIEW_SQL} WHERE r.id = $1 AND r.passenger_id = $2`, [rideId, passengerId]);
  if (!rows[0]) throw notFound('Ride not found');
  return toView(rows[0]);
}

export async function listRidesForPassenger(passengerId: string): Promise<RideView[]> {
  const { rows } = await query(`${RIDE_VIEW_SQL} WHERE r.passenger_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [passengerId]);
  return rows.map(toView);
}

export async function createRide(passengerId: string, input: RideInput): Promise<RideView> {
  return withTransaction(async (db) => {
    if (input.pickupZone === input.destinationZone) {
      throw badRequest('SAME_ZONE', 'Pickup and destination must differ');
    }
    await Promise.all([getZone(db, input.pickupZone), getZone(db, input.destinationZone)]);
    const distanceM = await getDistanceM(db, input.pickupZone, input.destinationZone);
    const solo = calculateFare({ distanceM, seats: input.seats, shared: false });

    // TeslaPay is simulated: the wallet must cover the worst case (the solo fare) up front.
    if (input.paymentMethod === 'TESLAPAY') {
      const { rows } = await db.query('SELECT wallet_paisa FROM users WHERE id = $1', [passengerId]);
      if (rows[0].wallet_paisa < solo.totalFarePaisa) {
        throw conflict('INSUFFICIENT_WALLET', 'TeslaPay balance is below the fare. Pay with cash or top up.', {
          requiredPaisa: solo.totalFarePaisa,
          balancePaisa: rows[0].wallet_paisa,
        });
      }
    }

    // The partial unique index (one active ride per passenger) turns a double submit into a 409.
    const { rows } = await db.query(
      `INSERT INTO ride_requests
         (passenger_id, pickup_zone, destination_zone, seats, payment_method,
          base_fare_paisa, distance_charge_paisa, pool_discount_paisa, total_fare_paisa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        passengerId,
        input.pickupZone,
        input.destinationZone,
        input.seats,
        input.paymentMethod,
        solo.baseFarePaisa,
        solo.distanceChargePaisa,
        solo.poolDiscountPaisa,
        solo.totalFarePaisa,
      ],
    );
    const rideId: string = rows[0].id;
    await recordEvent(db, {
      rideId,
      actorId: passengerId,
      type: 'RIDE_REQUESTED',
      to: 'REQUESTED',
      metadata: { pickup: input.pickupZone, destination: input.destinationZone, seats: input.seats, soloFarePaisa: solo.totalFarePaisa },
    });

    // If a compatible Tesla is already collecting passengers, take a seat immediately.
    // Otherwise the ride simply waits as REQUESTED until a driver accepts it.
    await autoJoin(db, await lockRide(db, rideId), passengerId);
    return getRideForPassenger(db, passengerId, rideId);
  });
}

export async function cancelRide(passengerId: string, rideId: string): Promise<RideView> {
  // A driver can accept the ride between our unlocked peek and our locks (see below). The
  // ride then has a pool we did not lock first, so we start over, now locking that pool.
  for (let attempt = 1; ; attempt++) {
    try {
      return await cancelRideOnce(passengerId, rideId);
    } catch (err) {
      if (attempt < 3 && err instanceof AppError && err.code === 'RIDE_CHANGED') continue;
      throw err;
    }
  }
}

async function cancelRideOnce(passengerId: string, rideId: string): Promise<RideView> {
  return withTransaction(async (db) => {
    // Peek (no lock) to learn which pool to lock first: lock order is always pool, then ride.
    const peek = await db.query('SELECT pool_id FROM ride_requests WHERE id = $1 AND passenger_id = $2', [rideId, passengerId]);
    if (!peek.rows[0]) throw notFound('Ride not found');
    const pool = peek.rows[0].pool_id ? await lockPool(db, peek.rows[0].pool_id) : null;

    const ride = await lockRide(db, rideId);
    if (ride.pool_id !== (pool?.id ?? null)) {
      throw conflict('RIDE_CHANGED', 'The ride changed while cancelling. Please try again.');
    }
    // Only REQUESTED and MATCHED can be cancelled. After the driver arrives the pool is
    // closed and fares are final, so DRIVER_ARRIVED, STARTED and finished rides are rejected here.
    assertRideTransition(ride.status as RideStatus, 'CANCELLED');

    if (pool) {
      await leavePool(db, pool, ride, passengerId, 'CANCELLED');
    } else {
      await db.query("UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [rideId]);
      await recordEvent(db, { rideId, actorId: passengerId, type: 'RIDE_CANCELLED', from: ride.status, to: 'CANCELLED' });
    }
    return getRideForPassenger(db, passengerId, rideId);
  });
}

export interface RideEventView {
  type: string;
  from: string | null;
  to: string | null;
  at: string;
  metadata: Record<string, unknown>;
}

/** The ride's own audit trail, oldest first. Only the ride's passenger may read it. */
export async function listRideEvents(passengerId: string, rideId: string): Promise<RideEventView[]> {
  await getRideForPassenger(pool, passengerId, rideId);
  const { rows } = await query(
    'SELECT event_type, from_status, to_status, created_at, metadata FROM ride_events WHERE ride_request_id = $1 ORDER BY id',
    [rideId],
  );
  return rows.map((e) => ({ type: e.event_type, from: e.from_status, to: e.to_status, at: e.created_at.toISOString(), metadata: e.metadata }));
}
