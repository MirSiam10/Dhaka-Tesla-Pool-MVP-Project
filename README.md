# Dhaka Tesla Pool

> Share a seat. Split the fare. Survive Dhaka traffic.

## Summary

Dhaka Tesla Pool is a ride-pooling MVP for three-seat battery rickshaws ("Teslas"). A passenger
requests a ride between two predefined Dhaka zones. A driver accepts it and opens a pool. Later
passengers whose trip is compatible join that same Tesla instantly, each with an **individual
discounted fare**, while the **seat capacity can never be exceeded**, even when two people grab
the last seat at the same instant.

The cast from the brief is used everywhere (seed data, tests, docs, screenshots):
**Jashim** drives **Bullet** (3 seats). **Nusrat** goes Banani to Mohakhali, **Rafiq** goes Banani
to Gulshan 1, and **Shirin** wants the last seat.

## Problem statement

Nusrat books Banani to Mohakhali. Two minutes later Rafiq books Banani to Gulshan 1. The system
must decide quickly whether they can share, split the fare fairly, keep each passenger's fare and
status private from the other, let the driver see who is riding and what stage they are at, and
keep enough history to explain what happened later. Shirin then competes for the last seat.

## Features implemented

| Area | What works |
|---|---|
| Passenger | Register and sign in. Request a ride (pickup, destination, 1 to 3 seats, Cash or TeslaPay). See the estimated solo and shared fare before booking. Track status with a progress bar. Cancel while valid. View ride history and the audit trail of each ride. |
| Driver | Sign in (drivers are seeded). Go online or offline. See waiting requests, with a reason when one cannot be accepted. Accept a request, which opens a pool or joins mine. See seats taken, passengers, drop-offs and fares. Mark arrival, start the trip, drop each passenger off, or cancel the pool. See earnings history. |
| Pool | Same pickup zone plus same corridor means shareable. Compatible requests auto-join an open Tesla. Each passenger gets an individual fare. Fares are recomputed when someone joins or cancels, and freeze when the driver arrives. |
| Integrity | Seat capacity enforced under concurrency (row lock, conditional update, CHECK constraint). Illegal state transitions rejected. Users cannot read or change another user's ride. Append-only audit log. |
| Payment | Cash, or a simulated TeslaPay wallet debited on completion. No real gateway. |
| Ops | `docker compose up`, health checks, migrations and seed on boot, structured logs, CI workflow. |

### Screenshots

| Driver sees a waiting request | Nusrat after Rafiq joins | Rafiq's own view |
|---|---|---|
| ![Driver requests](docs/screenshots/02-driver-requests.png) | ![Nusrat pooled](docs/screenshots/03-passenger-nusrat-pooled.png) | ![Rafiq pooled](docs/screenshots/04-passenger-rafiq-pooled.png) |

Jashim's console once Shirin has taken the last seat (3 of 3):

![Driver full pool](docs/screenshots/05-driver-full-pool.png)

Nusrat sees only her own fare (৳56) and a co-rider **count**, never Rafiq's name or fare.

## Architecture

```mermaid
flowchart LR
    B[Browser] -->|HTTPS| W["Next.js web<br/>(App Router, React)"]
    W -->|"/api/* proxied by a route handler<br/>REST + JSON, JWT bearer"| A["Node.js API<br/>(Express + TypeScript)"]
    A -->|"SQL over node-postgres pool<br/>transactions + row locks"| D[("PostgreSQL 16")]
```

Three deployable units and nothing else. No Redis, queues or microservices: nothing in the MVP
needs them. Full diagrams (layering, lifecycle, sequence, deployment): [docs/architecture.md](docs/architecture.md).

### Database / ERD

The complete ERD with every table, constraint and index explained is in
[docs/erd.md](docs/erd.md).

### Ride and pool lifecycle

```mermaid
stateDiagram-v2
    direction LR
    [*] --> REQUESTED: passenger requests
    REQUESTED --> MATCHED: driver accepts, or auto-join an OPEN pool
    REQUESTED --> CANCELLED: passenger cancels
    MATCHED --> CANCELLED: passenger cancels (before arrival)
    MATCHED --> DRIVER_ARRIVED: driver marks arrival
    DRIVER_ARRIVED --> STARTED: driver starts trip
    STARTED --> COMPLETED: driver completes this passenger
    COMPLETED --> [*]
    CANCELLED --> [*]
```

Improvements over the suggested lifecycle: arrive and start are **pool-level**, completion is
**passenger-level** (Nusrat gets off at Mohakhali while Rafiq rides on), and **boarding closes at
`DRIVER_ARRIVED`** so membership and fares are frozen. Reasons in [docs/architecture.md](docs/architecture.md).

## The matching rule

Two requests can share a Tesla when they have the **same pickup zone** and the **destination is in
the same corridor** as the pool. `EAST` = Banani, Mohakhali, Gulshan 1, Bashundhara. `NORTH` =
Uttara, Mirpur. `CENTRAL` = Farmgate, Dhanmondi. Nusrat (Mohakhali) and Rafiq (Gulshan 1) are both
`EAST`, so they match. The rule is one function in `backend/src/pooling/matching.ts`, applied the
same way for auto-join and for driver accept.

## The fare model (testable by hand)

```
perSeatSubtotal = baseFare + distanceKm * perKmRate      (4000 + km * 1500 paisa)
poolDiscount    = floor(perSeatSubtotal * seats * 20%)   only when 2+ passengers share
passengerFare   = perSeatSubtotal * seats - poolDiscount
```

| | Nusrat | Rafiq |
|---|---|---|
| Trip | Banani to Mohakhali (2 km) | Banani to Gulshan 1 (3 km) |
| Solo fare | 4000 + 3000 = 7000 (৳70) | 4000 + 4500 = 8500 (৳85) |
| Pool discount (20%) | 1400 | 1700 |
| **Pooled fare** | **5600 (৳56)** | **6800 (৳68)** |

**Money is stored as integer paisa.** Floats cannot represent most decimals exactly, and integers add
and compare exactly. The only inexact step, the percentage, is done in integer arithmetic and rounds
down. Details: [docs/fare-model.md](docs/fare-model.md).

## The concurrency problem: the last seat

Bullet has 1 seat left. Nusrat and Shirin both try to claim it at the same instant.

1. Every join runs in **one transaction** and first takes `SELECT ... FOR UPDATE` on the **pool row**.
   That row is the serialisation point for that Tesla.
2. After the lock, it re-reads the pool and runs an atomic conditional update:
   `UPDATE pools SET occupied_seats = occupied_seats + $n WHERE id = $1 AND occupied_seats + $n <= seat_capacity`.
   Zero rows updated means no room, and that passenger simply stays `REQUESTED`.
3. `CHECK (occupied_seats BETWEEN 0 AND seat_capacity)` is a **database backstop**: a future code bug
   cannot oversell Bullet.
4. Partial unique indexes allow one active pool per vehicle and one active ride per passenger
   (which also blocks double-submits).
5. Lock order is always pool, then ride. Deadlock and serialization errors (`40P01`, `40001`) are retried up to three times.

`backend/tests/concurrency.test.ts` fires simultaneous requests at the last seat against a real
Postgres and asserts that exactly one wins and occupancy never exceeds capacity.

**At larger scale** a Tesla's seat state would get a single writer: a geo-partitioned matching service
with per-region queues, plus idempotency keys on requests. See [docs/scaling.md](docs/scaling.md).

## Tech stack and justification

For every non-mandated choice: what, realistic alternatives, why it fits *this* MVP, and what would make me switch.

| Choice | Picked | Alternatives | Why it fits ride pooling | Switch when |
|---|---|---|---|---|
| Frontend (mandated) | Next.js App Router, plain CSS | React + Vite | Required stack. Plain CSS keeps the surface small. | A design system or many contributors appear. |
| Backend framework | Express 5 + TypeScript | NestJS, Fastify | The hard part is transactions and locking, not framework features. Express stays out of the way. | The API grows many modules that need DI and structure (NestJS), or throughput matters (Fastify). |
| Database | PostgreSQL 16 | MySQL, SQLite | Row locks, partial unique indexes and CHECK constraints are exactly what seat capacity needs. | Geospatial matching at scale: add PostGIS first, then a dedicated geo index. |
| Data access | `node-postgres` + plain SQL migrations | Prisma, Drizzle, Knex | `FOR UPDATE` and conditional updates are clearer in SQL than behind an ORM, and there is no query-engine binary to ship. | Many CRUD-heavy screens where generated types save time. |
| API style | REST + JSON | GraphQL, tRPC | Resources and state transitions map onto verbs. GraphQL adds a layer with no payoff for ~20 endpoints. | Several clients need different shapes of the same data. |
| Auth | JWT bearer + bcrypt | Sessions in Postgres, Auth.js, OAuth | Stateless and enough for one API. | Need instant revocation or social login. |
| Validation | zod | Joi, class-validator | One schema gives runtime validation and static types. | Never really. |
| Tests | Vitest + Supertest on **real Postgres** | Jest, mocked DB | Concurrency and constraints cannot be proven against a mock. | Test time grows: split unit and integration suites in CI. |
| Real-time | Short polling (3 s) | WebSockets, SSE | Status changes are infrequent. Polling needs no sticky sessions. | Latency complaints, or driver location streaming. |
| Hosting | Render (Docker) + Neon Postgres, or compose anywhere | Fly.io, Railway, a VM | Both have permanent free plans. | Traffic: move to paid autoscaling. |

Short form of key decisions: [docs/decisions.md](docs/decisions.md).

## Project structure

```
.
├── backend/              Express + TypeScript API
│   ├── migrations/       Plain SQL, applied in order by src/db/migrate.ts
│   ├── src/
│   │   ├── routes/       HTTP, zod validation, auth middleware
│   │   ├── services/     Business rules, transactions, state changes
│   │   ├── pooling/      Matching rule, lifecycle state machines, seat-locked pool operations
│   │   ├── fare/         Pure fare functions in integer paisa
│   │   ├── middleware/   Auth guards, error mapping
│   │   └── db/           pg pool, retrying transaction helper, migrate, seed
│   └── tests/            Vitest suites on real Postgres
├── web/                  Next.js App Router (passenger, driver, auth pages, API proxy)
├── docker/initdb/        Creates the separate test database on first boot
├── docs/                 Architecture, ERD, fare model, decisions, API, scaling, deployment
├── docker-compose.yml
├── render.yaml           Free-tier Render blueprint
└── .env.example
```

## Prerequisites

- **Docker** with Compose v2 (the easiest route), **or**
- Node.js 22+ and PostgreSQL 16 for running without Docker.

## Environment variables

Copy `.env.example` to `.env` to override defaults. **Never commit a real `.env`.** Every value has a
working development default, so `docker compose up` needs no `.env` at all.

| Variable | Purpose | Default |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials | `tesla` / `tesla` / `dhaka_tesla_pool` |
| `DB_PORT` | Host port for Postgres | `5432` |
| `API_PORT` | Host port for the API | `4000` |
| `JWT_SECRET` | Signs auth tokens. **Set a real one for any public deployment** (`openssl rand -hex 32`) | dev-only value |
| `SEED_ON_START` | Load the demo cast on boot (idempotent) | `true` |
| `LOG_LEVEL` | pino log level | `info` |
| `WEB_PORT` | Host port for the web app | `3000` |

## Run with Docker (recommended)

```bash
git clone <repo-url> && cd dhaka-tesla-pool
docker compose up --build
```

Then open **http://localhost:3000**. Startup order is `db` healthy, then `api` healthy (it runs
migrations and the seed, and `/health/ready` pings the database), then `web`. All containers are non-root.

## Run locally without Docker

```bash
# 1. Database (any Postgres 16). Example with Docker for the DB only:
docker compose up -d db

# 2. API
cd backend
npm install
export DATABASE_URL=postgres://tesla:tesla@localhost:5432/dhaka_tesla_pool
export JWT_SECRET=dev-only-secret-change-before-deploying-1234
npm run migrate      # apply SQL migrations
npm run seed         # Jashim, Bullet, Nusrat, Rafiq, Shirin (idempotent)
npm run dev          # http://localhost:4000

# 3. Web (new terminal)
cd web
npm install
API_URL=http://localhost:4000 npm run dev    # http://localhost:3000
```

## Tests

```bash
docker compose up -d db          # creates the separate dhaka_tesla_pool_test database
cd backend && npm install
npm test                         # 85 tests on a real Postgres
npm run typecheck
```

Override the database with `TEST_DATABASE_URL`. The suite drops and recreates its own schema each run.

What the tests prove (the risky parts, not coverage for its own sake):

| Risk from the brief | Where |
|---|---|
| Bullet's capacity can never be exceeded | `concurrency.test.ts` (races), `pooling.test.ts`, `schema.test.ts` (DB CHECK rejects overbooking directly) |
| Invalid state transitions are rejected | `lifecycle.test.ts` (state machines), `driverFlow.test.ts` (arrive, start, complete out of order) |
| Nusrat's and Rafiq's pooled fares (5600 and 6800) | `fare.test.ts` (pure maths), `pooling.test.ts` and `driverFlow.test.ts` (end to end) |
| Users cannot read or modify another user's ride | `rides.test.ts`, `pooling.test.ts` (co-riders see only a count) |
| Cancellation rules and fare repricing | `rides.test.ts`, `pooling.test.ts`, `lifecycle.test.ts` |
| Concurrent requests cannot corrupt pool capacity | `concurrency.test.ts`: Nusrat vs Shirin for the last seat, repeated races, twelve requests for three seats, double accept, cancel racing accept |
| Auth: duplicate email, tampered token, role guards | `auth.test.ts` |
| Matching rule and zones | `matching.test.ts`, `zones.test.ts` |

## Demo credentials

Public demo data from the seed, not secrets. Password for everyone: **`Tesla@1234`**

| Role | Email | Story |
|---|---|---|
| Driver | `jashim@example.com` | Drives Bullet (3 seats) |
| Passenger | `nusrat@example.com` | Banani to Mohakhali |
| Passenger | `rafiq@example.com` | Banani to Gulshan 1 |
| Passenger | `shirin@example.com` | Wants the last seat |

Each passenger starts with ৳500 in TeslaPay. The login page has one-click buttons for all four.

### Try the story

1. Sign in as **Jashim** and click **Go online**.
2. In another browser profile, sign in as **Nusrat** and book Banani to Mohakhali.
3. Back as Jashim, **accept** her request. A pool opens, 1 of 3 seats.
4. As **Rafiq**, book Banani to Gulshan 1. He is matched instantly. Nusrat's fare drops to ৳56, Rafiq's is ৳68.
5. As **Shirin**, book Banani to Gulshan 1 and take the last seat. A fourth request would stay `REQUESTED`.
6. As Jashim: **arrive**, **start**, then drop off Nusrat and Rafiq in turn. The pool completes.

A scripted version with `curl` is in [docs/api.md](docs/api.md).

## API overview

REST + JSON under `/api`, JWT bearer auth. Errors always look like
`{ "error": { "code", "message" } }`. The full table with request shapes is in [docs/api.md](docs/api.md).

| Group | Endpoints |
|---|---|
| Public | `GET /health`, `GET /health/ready`, `GET /api/zones`, `GET /api/fare/estimate`, `POST /api/auth/register`, `POST /api/auth/login` |
| Passenger | `POST /api/rides`, `GET /api/rides`, `GET /api/rides/:id`, `GET /api/rides/:id/events`, `POST /api/rides/:id/cancel` |
| Driver | `GET /api/driver/me`, `POST /api/driver/status`, `GET /api/driver/requests`, `POST /api/driver/requests/:id/accept`, `GET /api/driver/pool`, `POST /api/driver/pool/{arrive,start,cancel}`, `POST /api/driver/pool/rides/:id/complete`, `GET /api/driver/history` |

## Deployment

Free tier only, nothing paid. Two routes, both documented step by step in
[docs/deployment.md](docs/deployment.md): **Render + Neon** (public URL) and **plain
`docker compose up`** on any machine. The same images are used in both.

Deployment URL: `TODO: add after deploying`

## Key decisions and trade-offs

- **Pool row lock instead of optimistic retries.** A short pessimistic lock on one pool row is simple to reason about and cheap at this scale. Trade-off: all writers for one Tesla queue behind each other, which is fine because a Tesla has three seats.
- **Auto-join on request.** Matches the brief's "decide in about a second". Trade-off: the driver does not approve each later rider. They approved the pool and can cancel it before arrival.
- **Boarding closes at arrival.** Freezes fares and membership. Trade-off: no mid-trip pickups.
- **Waiting riders are not auto-promoted.** If a seat frees up, a waiting `REQUESTED` rider is not pulled in automatically. That needs a background matcher, which would be complexity without evidence of need.
- **Zones and hand-set distances instead of maps.** The brief says not to rebuild Google Maps. Trade-off: distances are approximate and fixed.
- **JWT in browser storage.** Simple and enough here. Trade-off: exposed to XSS, so a production build would use an httpOnly cookie.
- **Polling, not WebSockets.** Fewer moving parts. Trade-off: up to 3 s delay.

Full assumption list (A1 to A10): [docs/decisions.md](docs/decisions.md).

## Known limitations

- No real payments, no refunds, no cancellation fees or no-show handling.
- Drivers are seeded, not self-registered, and there is no vehicle verification.
- One Tesla per driver, one active ride per passenger.
- Geography is a fixed list of 8 zones with fixed distances. No live traffic.
- No password reset, email verification or token refresh.
- Short polling instead of push updates.
- Compose and the production build were validated for configuration and builds; run `docker compose up --build` on your machine to confirm images build in your environment.

## Next improvements

1. Background matcher that fills freed seats from the waiting queue.
2. Idempotency keys on `POST /rides`.
3. Real-time updates over SSE.
4. PostGIS and true route-based matching.
5. Cancellation fees and driver ratings.
6. httpOnly cookie sessions and refresh tokens.

## If Oi Tesla goes viral (bonus)

Scaling to 1M passengers and 100k drivers: load balancing, stateless horizontal scaling, indexing and
read replicas, caching, geospatial search, queues and events, real-time, rate limiting, idempotency,
observability, DB contention, matching, failure strategy, security and deployment, plus what is
deliberately *not* built now. See [docs/scaling.md](docs/scaling.md).

## AI usage

I used **Claude** (Anthropic, via Claude Code) as a pair engineer for this project. I am not hiding
it: it wrote most of the first drafts of the code, tests and docs under my direction, including the
design-first approach, the branch plan and the commit history. Most commits carry a
`Co-Authored-By: Claude` trailer (a handful of early documentation commits predate that and do not,
but they were drafted the same way). Other tools: PostgreSQL, Next.js and Express documentation.

| Used for | Notes |
|---|---|
| Architecture and ERD drafts | I reviewed the table design and constraints and can explain each one. |
| API, SQL migrations, pooling logic | Drafted by Claude, then verified by running the 85 tests and a live walkthrough. |
| Test suites | Concurrency, lifecycle, fare and auth tests, run on real Postgres. |
| Frontend | Passenger and driver pages, checked in a real browser (see screenshots). |

**One suggestion I accepted:** lock the pool row with `SELECT ... FOR UPDATE`, update occupancy with a
conditional `WHERE occupied_seats + n <= seat_capacity`, and also keep a `CHECK` constraint as a
backstop. It is simple, provable with a test, and fails safe if application code has a bug.

**One suggestion I changed:** the first design proxied API calls with a `next.config` rewrite. Rewrites
are baked in at build time, so one Docker image could not point at different APIs. I replaced it with a
Next.js route handler that reads `API_URL` on every request, so the same image runs on a laptop, in
Compose and on Render. The change is recorded in [docs/architecture.md](docs/architecture.md).

The bar is understanding, not provenance: I can walk through the schema, the state machine, how
the lock prevents overbooking, and how the app fails. Talking points are in
[docs/walkthrough.md](docs/walkthrough.md).

## Git workflow

Long-lived branches: `master`, `pre-release`, `release/v1.0.0` (tagged `v1.0.0`). Each logical change
was built on a `feature/*` branch with incremental commits and merged into `master` once it worked.
Once the MVP was integrated, `pre-release` took integration fixes, CI, docs and deployment checks, and
`release/v1.0.0` was cut from it. Commits follow `<type>(<scope>): <description>`.

```bash
git log --graph --oneline --all
```
