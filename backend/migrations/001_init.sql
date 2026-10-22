-- Dhaka Tesla Pool: core schema.
-- Money is integer paisa everywhere. See docs/erd.md for the reasoning behind each table.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  email         text        NOT NULL CHECK (position('@' in email) > 1),
  phone         text,
  password_hash text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
  wallet_paisa  integer     NOT NULL DEFAULT 0 CHECK (wallet_paisa >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE zones (
  code     text PRIMARY KEY,
  name     text NOT NULL,
  corridor text NOT NULL CHECK (corridor IN ('EAST', 'NORTH', 'CENTRAL')),
  lat      numeric(9, 6) NOT NULL,
  lng      numeric(9, 6) NOT NULL
);

-- One row per unordered pair; zone_a < zone_b keeps the pair unique regardless of direction.
CREATE TABLE zone_distances (
  zone_a      text    NOT NULL REFERENCES zones (code),
  zone_b      text    NOT NULL REFERENCES zones (code),
  distance_m  integer NOT NULL CHECK (distance_m > 0),
  PRIMARY KEY (zone_a, zone_b),
  CHECK (zone_a < zone_b)
);

CREATE TABLE vehicles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid    NOT NULL UNIQUE REFERENCES users (id),
  name       text    NOT NULL,
  plate      text    NOT NULL UNIQUE,
  capacity   integer NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  is_online  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid    NOT NULL REFERENCES vehicles (id),
  pickup_zone    text    NOT NULL REFERENCES zones (code),
  corridor       text    NOT NULL,
  status         text    NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  seat_capacity  integer NOT NULL CHECK (seat_capacity >= 1),
  occupied_seats integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  arrived_at     timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  -- Database backstop for the capacity rule. Application code also checks first.
  CONSTRAINT pools_occupied_within_capacity CHECK (occupied_seats BETWEEN 0 AND seat_capacity)
);
-- One live pool per Tesla.
CREATE UNIQUE INDEX pools_one_active_per_vehicle
  ON pools (vehicle_id) WHERE status IN ('OPEN', 'DRIVER_ARRIVED', 'STARTED');
CREATE INDEX pools_vehicle_created_idx ON pools (vehicle_id, created_at DESC);
CREATE INDEX pools_open_match_idx ON pools (pickup_zone, corridor) WHERE status = 'OPEN';

CREATE TABLE ride_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id          uuid    NOT NULL REFERENCES users (id),
  pool_id               uuid    REFERENCES pools (id),
  pickup_zone           text    NOT NULL REFERENCES zones (code),
  destination_zone      text    NOT NULL REFERENCES zones (code),
  seats                 integer NOT NULL CHECK (seats >= 1),
  status                text    NOT NULL DEFAULT 'REQUESTED'
                          CHECK (status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  payment_method        text    NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'TESLAPAY')),
  base_fare_paisa       integer NOT NULL CHECK (base_fare_paisa >= 0),
  distance_charge_paisa integer NOT NULL CHECK (distance_charge_paisa >= 0),
  pool_discount_paisa   integer NOT NULL DEFAULT 0 CHECK (pool_discount_paisa >= 0),
  total_fare_paisa      integer NOT NULL CHECK (total_fare_paisa >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  matched_at            timestamptz,
  arrived_at            timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  CHECK (pickup_zone <> destination_zone),
  CHECK (total_fare_paisa = base_fare_paisa + distance_charge_paisa - pool_discount_paisa),
  CHECK (status <> 'REQUESTED' OR pool_id IS NULL),
  CHECK (status NOT IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED') OR pool_id IS NOT NULL)
);
-- One live ride per passenger (also blocks accidental double submits).
CREATE UNIQUE INDEX ride_requests_one_active_per_passenger
  ON ride_requests (passenger_id) WHERE status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');
CREATE INDEX ride_requests_passenger_created_idx ON ride_requests (passenger_id, created_at DESC);
CREATE INDEX ride_requests_open_idx ON ride_requests (status, pickup_zone, created_at);
CREATE INDEX ride_requests_pool_idx ON ride_requests (pool_id);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id uuid    NOT NULL UNIQUE REFERENCES ride_requests (id),
  method          text    NOT NULL CHECK (method IN ('CASH', 'TESLAPAY')),
  amount_paisa    integer NOT NULL CHECK (amount_paisa >= 0),
  status          text    NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail: answers "what exactly happened?" long after a ride ends.
CREATE TABLE ride_events (
  id              bigserial PRIMARY KEY,
  ride_request_id uuid REFERENCES ride_requests (id),
  pool_id         uuid REFERENCES pools (id),
  actor_id        uuid REFERENCES users (id),
  event_type      text NOT NULL,
  from_status     text,
  to_status       text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ride_request_id IS NOT NULL OR pool_id IS NOT NULL)
);
CREATE INDEX ride_events_ride_idx ON ride_events (ride_request_id, created_at);
CREATE INDEX ride_events_pool_idx ON ride_events (pool_id, created_at);

CREATE FUNCTION ride_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ride_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ride_events_no_update_delete
  BEFORE UPDATE OR DELETE ON ride_events
  FOR EACH ROW EXECUTE FUNCTION ride_events_immutable();
