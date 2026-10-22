import type { Db } from '../db/pool';

export interface RideEventInput {
  rideId?: string | null;
  poolId?: string | null;
  actorId?: string | null;
  type: string;
  from?: string | null;
  to?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends to the audit trail. Always call it with the same transaction client as the state
 * change it describes, so the event and the change commit (or roll back) together.
 * The table is append-only at the database level (trigger), so history cannot be rewritten.
 */
export async function recordEvent(db: Db, e: RideEventInput): Promise<void> {
  await db.query(
    `INSERT INTO ride_events (ride_request_id, pool_id, actor_id, event_type, from_status, to_status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.rideId ?? null, e.poolId ?? null, e.actorId ?? null, e.type, e.from ?? null, e.to ?? null, JSON.stringify(e.metadata ?? {})],
  );
}
