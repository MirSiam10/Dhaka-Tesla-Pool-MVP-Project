# API overview

REST + JSON. Base path `/api` (the browser reaches it through Next.js at the same origin,
or directly at `http://localhost:4000/api`). Protected routes need
`Authorization: Bearer <token>` from login or registration.

**Why REST:** the domain is a handful of resources with explicit state transitions
(`POST /driver/pool/arrive`), which map directly onto verbs and status codes. GraphQL would
add a schema and resolver layer without removing any query we actually make. Switch if
several client types start needing very different shapes of the same data.

## Errors

Every failure has the same shape and a stable `code`:

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "A ride cannot move from STARTED to CANCELLED", "details": {} } }
```

| Status | When | Example codes |
|---|---|---|
| 400 | Bad input | `VALIDATION_ERROR`, `UNKNOWN_ZONE`, `SAME_ZONE` |
| 401 | Missing, invalid or expired token | `UNAUTHORIZED` |
| 403 | Wrong role | `FORBIDDEN` |
| 404 | Not found, **or not yours** (never confirms another user's ride exists) | `NOT_FOUND` |
| 409 | State conflict | `INVALID_TRANSITION`, `ACTIVE_RIDE_EXISTS`, `RIDE_NOT_AVAILABLE`, `CANNOT_POOL`, `POOL_CLOSED`, `DRIVER_OFFLINE`, `INSUFFICIENT_WALLET`, `EMAIL_TAKEN` |
| 429 | Too many auth attempts | `RATE_LIMITED` |
| 500 | Bug (details only in logs) | `INTERNAL` |

## Public

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness |
| `GET /health/ready` | Readiness (database answers) |
| `GET /api/zones` | The predefined Dhaka zones and their corridors |
| `GET /api/fare/estimate?pickup=BANANI&destination=MOHAKHALI&seats=1` | Solo and shared fare, plus the fare rules |
| `POST /api/auth/register` | Create a passenger. Returns `{ token, user }`. Drivers cannot self-register. |
| `POST /api/auth/login` | Returns `{ token, user }` |

## Any signed-in user

| Method and path | Purpose |
|---|---|
| `GET /api/auth/me` | The current user, including TeslaPay balance |

## Passenger

| Method and path | Purpose |
|---|---|
| `POST /api/rides` | Request a ride `{ pickupZone, destinationZone, seats, paymentMethod }`. Joins an open Tesla instantly if one fits. |
| `GET /api/rides` | My rides, newest first |
| `GET /api/rides/:id` | One of my rides (fare breakdown, pool info, co-passenger **count** only) |
| `GET /api/rides/:id/events` | My ride's audit trail |
| `POST /api/rides/:id/cancel` | Cancel while `REQUESTED` or `MATCHED` |

## Driver

| Method and path | Purpose |
|---|---|
| `GET /api/driver/me` | My Tesla, online state, active pool |
| `POST /api/driver/status` | `{ online: boolean }`. Refused while a pool is live. |
| `GET /api/driver/requests` | Waiting requests, each with `canAccept` and a `reason` if not |
| `POST /api/driver/requests/:id/accept` | Accept: opens a pool or joins mine (matching rule applies) |
| `GET /api/driver/pool` | My active pool: seats, passengers, per-rider fares |
| `POST /api/driver/pool/arrive` | `OPEN` to `DRIVER_ARRIVED`. Boarding closes, fares freeze. |
| `POST /api/driver/pool/start` | `DRIVER_ARRIVED` to `STARTED` |
| `POST /api/driver/pool/rides/:id/complete` | Drop one passenger off and record payment. The pool completes after the last one. |
| `POST /api/driver/pool/cancel` | Abandon the pool before the trip. Riders go back to `REQUESTED`. |
| `GET /api/driver/history` | Finished pools and earnings |

## Example: the Banani story over HTTP

Needs `curl` and `jq`, with the stack running and the demo data seeded.

```bash
API=http://localhost:4000/api
login() { curl -s $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1@example.com\",\"password\":\"Tesla@1234\"}" | jq -r .token; }
J=$(login jashim); N=$(login nusrat); R=$(login rafiq)

curl -s -X POST $API/driver/status -H "authorization: Bearer $J" -H 'content-type: application/json' -d '{"online":true}'
RIDE=$(curl -s -X POST $API/rides -H "authorization: Bearer $N" -H 'content-type: application/json' \
  -d '{"pickupZone":"BANANI","destinationZone":"MOHAKHALI","seats":1,"paymentMethod":"CASH"}' | jq -r .ride.id)
curl -s -X POST $API/driver/requests/$RIDE/accept -H "authorization: Bearer $J" | jq '.pool.occupiedSeats'
curl -s -X POST $API/rides -H "authorization: Bearer $R" -H 'content-type: application/json' \
  -d '{"pickupZone":"BANANI","destinationZone":"GULSHAN_1","seats":1,"paymentMethod":"CASH"}' | jq '.ride | {status, fare}'
```
