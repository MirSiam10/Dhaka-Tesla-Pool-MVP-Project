# Database design

PostgreSQL 16. Plain SQL migrations, no ORM. All money is `INTEGER` paisa.

```mermaid
erDiagram
    users ||--o| vehicles : "drives (1 Tesla per driver)"
    users ||--o{ ride_requests : "requests"
    vehicles ||--o{ pools : "runs"
    pools ||--o{ ride_requests : "contains"
    zones ||--o{ ride_requests : "pickup / destination"
    zones ||--o{ pools : "pickup"
    zones ||--o{ zone_distances : "pair"
    ride_requests ||--o| payments : "paid by"
    ride_requests ||--o{ ride_events : "history"
    pools ||--o{ ride_events : "history"
    users ||--o{ ride_events : "actor"

    users {
        uuid id PK
        text name
        text email UK
        text phone
        text password_hash
        text role "PASSENGER | DRIVER"
        int wallet_paisa "simulated TeslaPay"
        timestamptz created_at
    }
    vehicles {
        uuid id PK
        uuid driver_id FK,UK
        text name "e.g. Bullet"
        text plate UK
        int capacity "CHECK 1..6"
        bool is_online
    }
    zones {
        text code PK "BANANI, MOHAKHALI, ..."
        text name
        text corridor "EAST | NORTH | CENTRAL"
        numeric lat
        numeric lng
    }
    zone_distances {
        text zone_a PK,FK
        text zone_b PK,FK
        int distance_m "CHECK zone_a < zone_b"
    }
    pools {
        uuid id PK
        uuid vehicle_id FK
        text pickup_zone FK
        text corridor
        text status "OPEN | DRIVER_ARRIVED | STARTED | COMPLETED | CANCELLED"
        int seat_capacity
        int occupied_seats "CHECK 0..seat_capacity"
        timestamptz created_at
    }
    ride_requests {
        uuid id PK
        uuid passenger_id FK
        uuid pool_id FK "null until matched"
        text pickup_zone FK
        text destination_zone FK
        int seats
        text status
        text payment_method "CASH | TESLAPAY"
        int base_fare_paisa
        int distance_charge_paisa
        int pool_discount_paisa
        int total_fare_paisa "CHECK = base + distance - discount"
        timestamptz created_at
    }
    payments {
        uuid id PK
        uuid ride_request_id FK,UK
        text method
        int amount_paisa
        text status
    }
    ride_events {
        bigint id PK
        uuid ride_request_id FK
        uuid pool_id FK
        uuid actor_id FK
        text event_type
        text from_status
        text to_status
        jsonb metadata
        timestamptz created_at
    }
```

## Tables

| Table | Why it exists |
|---|---|
| `users` | One table for passengers and drivers, split by `role`. Auth identity plus the simulated TeslaPay wallet balance. |
| `vehicles` | A Tesla with a fixed `capacity`. `driver_id` is unique, so one driver has one Tesla. `is_online` is the driver's availability. |
| `zones` | The predefined Dhaka areas. `corridor` drives the matching rule. Zone `code` is the key, so API payloads and seed data stay readable. |
| `zone_distances` | Hand-set road distances between zone pairs (metres), stored once per unordered pair. Makes the fare testable by hand. |
| `pools` | One Tesla's current trip. Carries `seat_capacity` (copied from the vehicle at creation) and `occupied_seats`, the field the capacity constraint protects. |
| `ride_requests` | One passenger's trip. Fare components are stored on the row, so a past ride is explainable even if pricing constants change. |
| `payments` | One payment record per completed ride (cash, or simulated wallet debit). |
| `ride_events` | Append-only history: every status change with actor, from, to, and metadata. This is what answers "what exactly happened?". A trigger blocks `UPDATE` and `DELETE`. |

## Constraints worth knowing

- `pools.occupied_seats BETWEEN 0 AND seat_capacity`: the capacity backstop.
- Unique index on `pools(vehicle_id)` where status is active: one live pool per Tesla.
- Unique index on `ride_requests(passenger_id)` where status is active: one live ride per
  passenger.
- `total_fare_paisa = base_fare_paisa + distance_charge_paisa - pool_discount_paisa`.
- `pickup_zone <> destination_zone`, `seats >= 1`.
- `REQUESTED` rides have no pool; `MATCHED`, `DRIVER_ARRIVED` and `STARTED` rides must have one.

## Indexes

| Index | Serves |
|---|---|
| `ride_requests(passenger_id, created_at DESC)` | Passenger history |
| `ride_requests(status, pickup_zone, created_at)` | Driver's list of open requests |
| `ride_requests(pool_id)` | Pool membership lookups |
| `pools(vehicle_id, created_at DESC)` | Driver history |
| `pools(pickup_zone, corridor)` where `status = 'OPEN'` | Auto-join candidate search |
| `ride_events(ride_request_id, created_at)` | Ride audit trail |
