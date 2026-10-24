-- Runs once, the first time the Postgres volume is created.
-- A separate database for `npm test`, so tests can wipe their schema without touching demo data.
CREATE DATABASE dhaka_tesla_pool_test;
