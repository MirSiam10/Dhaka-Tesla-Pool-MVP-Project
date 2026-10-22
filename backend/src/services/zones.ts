import { type Db, query } from '../db/pool';
import { badRequest } from '../errors';

export interface Zone {
  code: string;
  name: string;
  corridor: string;
  lat: number;
  lng: number;
}

export async function listZones(): Promise<Zone[]> {
  const { rows } = await query('SELECT code, name, corridor, lat::float AS lat, lng::float AS lng FROM zones ORDER BY name');
  return rows;
}

/** Throws 400 UNKNOWN_ZONE if the code is not one of the predefined zones. */
export async function getZone(db: Db, code: string): Promise<Zone> {
  const { rows } = await db.query('SELECT code, name, corridor, lat::float AS lat, lng::float AS lng FROM zones WHERE code = $1', [code]);
  if (!rows[0]) throw badRequest('UNKNOWN_ZONE', `Unknown zone "${code}"`);
  return rows[0];
}

/** Hand-set road distance in metres between two different zones (stored once per unordered pair). */
export async function getDistanceM(db: Db, a: string, b: string): Promise<number> {
  const { rows } = await db.query(
    'SELECT distance_m FROM zone_distances WHERE zone_a = LEAST($1::text, $2::text) AND zone_b = GREATEST($1::text, $2::text)',
    [a, b],
  );
  if (!rows[0]) throw badRequest('NO_DISTANCE', `No distance defined between ${a} and ${b}`);
  return rows[0].distance_m;
}
