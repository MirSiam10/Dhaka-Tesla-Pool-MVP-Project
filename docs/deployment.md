# Deployment

Rule from the brief: **free only, no paid services**. Three routes, in order of preference.

## Route 1: Docker Compose (reproducible anywhere)

```bash
git clone <repo-url> && cd dhaka-tesla-pool
docker compose up --build
# open http://localhost:3000
```

No `.env` is needed; every value has a development default. Copy `.env.example` to `.env`
to override ports or set `JWT_SECRET`. This is also the answer if no free host is available:
the same compose file runs on any machine, including a free-tier cloud VM.

## Route 2: Public free-tier hosting (Render + Neon)

| Piece | Where | Why |
|---|---|---|
| Postgres | **Neon** free plan | Permanent free plan, no card. Render's free Postgres expires after 30 days. |
| API | **Render** free web service (Docker) | Runs our `backend/Dockerfile` unchanged. |
| Web | **Render** free web service (Docker) | Runs our `web/Dockerfile` unchanged. |

Steps:

1. **Neon:** create a project, copy the connection string (it ends in `?sslmode=require`).
2. **Render:** *New, Blueprint*, point at this repository. `render.yaml` defines both
   services. When prompted, set `DATABASE_URL` to the Neon string. `JWT_SECRET` is generated
   by Render.
3. Deploy the API first. Copy its public URL (for example
   `https://dhaka-tesla-api.onrender.com`).
4. On the web service set `API_URL` to that URL and redeploy.
5. Open the web URL and sign in with a demo account. The API runs migrations and seeds the
   demo cast on boot, so there is nothing else to do.
6. Put the web URL in the README under *Deployment*.

### Limits to know about

Checked against the providers' own pages in October 2026. These change, so re-check before
relying on them.

- **Render free web services** spin down after 15 minutes without traffic and take about a
  minute to start again; they get 750 instance hours per month, an ephemeral filesystem and
  one instance only. Source: [Render free tier docs](https://render.com/docs/free).
  *Effect on this app:* open the site once before a demo or a recording to warm both services.
  Nothing is stored on disk, so the spin-down loses nothing.
- **Neon free plan**: 1 GB storage per project, 100 compute-hours per project, compute
  suspends after 5 minutes idle and resumes on the next query. Source:
  [Neon pricing](https://neon.com/pricing). *Effect:* the first request after idle is slower.
  The data set here is a few kilobytes.

### If a free backend host is unavailable

Document the constraint and ship Route 1. The repository, `docker-compose.yml`, seed data and
`.env.example` are enough for an evaluator to run everything with one command.

## Environment variables

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | api | Postgres connection string |
| `JWT_SECRET` | api | Signs tokens. 16+ characters; use `openssl rand -hex 32` |
| `SEED_ON_START` | api | `true` loads Jashim, Bullet, Nusrat, Rafiq, Shirin. Idempotent. |
| `PORT` | api, web | Listen port (hosting platforms inject this) |
| `API_URL` | web | Where the Next.js server reaches the API. Read per request. |

Never commit real values. `.env`, `.env.*` are git-ignored; only `.env.example` is tracked.
