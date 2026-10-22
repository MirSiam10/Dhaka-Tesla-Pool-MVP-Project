import { Client } from 'pg';

// Tests run against a real PostgreSQL: row locks, constraints and concurrency cannot be
// proven with mocks. Point TEST_DATABASE_URL at a throwaway database. The default matches
// the Postgres published by `docker compose up db` (see backend/README notes).
const DEFAULT_URL = 'postgres://tesla:tesla@localhost:5432/dhaka_tesla_pool_test';

export async function setup() {
  const url = process.env.TEST_DATABASE_URL || DEFAULT_URL;
  process.env.DATABASE_URL = url;

  // Start every run from an empty schema so migrations are exercised from scratch.
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
}
