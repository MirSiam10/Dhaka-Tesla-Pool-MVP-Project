# Walkthrough: video script and interview notes

Use this to rehearse. If you cannot explain a line here in your own words, read the code it points to
until you can.

## Six-minute video plan

| Time | Say | Show |
|---|---|---|
| 0:00 to 1:00 | The problem in your own words: strangers sharing a three-seat rickshaw, each paying a fair individual price, nobody able to oversell the last seat. Who the users are: passenger, driver, and the pool in between. | Face or title slide |
| 1:00 to 3:00 | Engineering: browser, Next.js, Express API, Postgres. Layering (routes, services, pooling, fare). The lifecycle diagram. **One key decision:** lock the pool row, then conditionally update occupancy, with a CHECK backstop. **One trade-off:** auto-join means the driver does not approve each later rider. | `docs/architecture.md` diagram, `docs/erd.md` ERD, `backend/src/pooling/poolService.ts` |
| 3:00 to 6:00 | Product tour: Jashim online, Nusrat books, Jashim accepts, Rafiq auto-joins, fares become ৳56 and ৳68, Shirin takes the last seat, a fourth request waits. Arrive, start, drop-offs. One edge case: run the concurrency test. Show deployment if you have it. | Two browser profiles side by side, then the terminal running `npm test -- concurrency` |

## Questions to expect, and where the answer lives

**How do you stop two people taking the last seat?**
One transaction takes `SELECT ... FOR UPDATE` on the pool row, so the second request waits. Then
`UPDATE pools SET occupied_seats = occupied_seats + n WHERE ... AND occupied_seats + n <= seat_capacity`
either changes one row (seat taken) or zero rows (no room, passenger stays `REQUESTED`). The
`pools_occupied_within_capacity` CHECK catches any code bug. Code: `backend/src/pooling/poolService.ts`.
Test: `backend/tests/concurrency.test.ts`.

**What if you had a million users?**
Seat state needs one writer. Geo-partition matching into regions, one queue per region, idempotency keys on
requests, read replicas for history, Redis only for hot reads. See `docs/scaling.md`.

**Why a lock and not optimistic concurrency?**
A pool has at most three seats, so contention per Tesla is tiny and a short lock is easier to prove correct
than retry loops. Optimistic versioning makes sense when conflicts are rare and locks are expensive.

**How can deadlocks happen, and what do you do?**
Lock order is always pool, then ride request. If it still happens (`40P01`) or serialization fails
(`40001`), `withTransaction` retries up to three times.

**Why integer paisa?**
Exact addition and comparison. The only inexact step is the percentage, done in integers and rounded down.

**Show me Nusrat's and Rafiq's fares by hand.**
Nusrat: 4000 + 2 km x 1500 = 7000, minus 20% (1400) = 5600. Rafiq: 4000 + 3 km x 1500 = 8500, minus 20%
(1700) = 6800.

**What happens if Rafiq cancels after Nusrat is matched?**
His seat is released, Nusrat is repriced back to the solo 7000 in the same transaction, and the audit log
records both events.

**Why can a passenger not cancel after the driver arrives?**
Boarding closes at `DRIVER_ARRIVED` so membership and fares are frozen. No-show fees are out of scope.

**How does auth work, and what is weak about it?**
bcrypt-hashed passwords, a signed JWT bearer token, role guards, rate limiting on auth routes, helmet.
Weakness: the token sits in browser storage, so XSS could read it. A production build would use an
httpOnly cookie plus refresh tokens.

**Why is the ride id safe against guessing?**
UUIDs, and every ride query is scoped by the authenticated passenger, so someone else's id returns
not found rather than their data.

**Why not Prisma?**
The interesting SQL here is `FOR UPDATE` and conditional updates. Plain SQL shows exactly what the database
does and avoids shipping a query engine. I would switch for many CRUD-heavy screens.

**What would you change first with another week?**
A background matcher to fill freed seats, idempotency keys on `POST /rides`, and SSE for live status.

## Commands for the demo

```bash
docker compose up --build            # then http://localhost:3000
cd backend && npm test               # 85 tests
npm test -- concurrency              # the last-seat race
git log --graph --oneline --all      # the engineering journey
```
