# Assumptions and key decisions

Section 17 of the brief invites assumptions. These are ours, applied consistently.

## Product assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | **Matching rule:** two requests can share a Tesla if they have the **same pickup zone** and their **destination zones are in the same corridor** as the pool's first rider. | Nusrat (Banani to Mohakhali) and Rafiq (Banani to Gulshan 1) have overlapping but different trips, and both destinations are in the `EAST` corridor. It is simple enough to explain in one sentence and to test. |
| A2 | Corridors: `EAST` = Banani, Mohakhali, Gulshan 1, Bashundhara. `NORTH` = Uttara, Mirpur. `CENTRAL` = Farmgate, Dhanmondi. | Coarse geography. No routing needed. |
| A3 | A driver **accepts** a request, which creates a pool. While the pool is `OPEN` and has free seats, later compatible requests **join instantly** without waiting for another driver tap. | Matches the story: Rafiq books and the app decides in about a second. |
| A4 | Boarding closes at `DRIVER_ARRIVED`. No joins or cancellations after that. | Freezes membership and fares. No-show and late-cancel fees are out of scope. |
| A5 | One active ride per passenger. One Tesla per driver. One active pool per Tesla. | Keeps invariants enforceable by unique indexes. |
| A6 | A request asks for 1 to 3 seats. It can only join a pool with enough free seats. | Capacity is per Tesla; Bullet has 3. |
| A7 | If a pool has no room, the passenger stays `REQUESTED` and a driver can still accept them. Freed seats do **not** auto-pull waiting riders in the MVP. | Auto-promotion needs a background matcher. Listed under next improvements. |
| A8 | Drivers are seeded, not self-registered. Passengers self-register. | Driver onboarding needs vehicle verification, which is out of scope. |
| A9 | Drivers must be online to accept requests or have riders auto-join. A driver cannot go offline while a pool is active. | Prevents stranding passengers. |
| A10 | Passengers see only their own fare and status. A pool shows them the Tesla name, driver first name and a co-passenger **count**, never co-passenger identities or fares. | Privacy requirement from the brief. |

## Technology choices (summary)

The README carries the full "what, alternatives, why, when to switch" table. Short form:

| Area | Pick | Main reason |
|---|---|---|
| Backend | Express + TypeScript | Thin and explicit. The interesting logic is transactions, not framework features. |
| DB | PostgreSQL | Row locks, partial unique indexes and CHECK constraints are exactly what pool capacity needs. |
| Data access | `node-postgres` + SQL migrations | Locking and conditional updates are clearer in plain SQL than behind an ORM. |
| Auth | JWT bearer + bcrypt | Stateless, enough for one API. |
| Validation | zod | One schema gives runtime validation and static types. |
| Tests | Vitest + Supertest against real Postgres | Concurrency behaviour cannot be proven against a mock. |
| Frontend | Next.js App Router, plain CSS | Required stack. No UI library, to keep the surface small. |
| API style | REST | Resources and transitions map cleanly onto verbs; GraphQL adds a layer with no payoff here. |
