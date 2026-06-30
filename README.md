# Deploying parallel_etl

## ⚠️ First: rotate your DB credentials
Your uploaded zip had the Neon password in plaintext in `backend/.env` and `run.sh`.
Anyone who's seen that zip (or its zip history) can read it. Before deploying:
1. Neon dashboard → your project → Settings → reset the role password.
2. Use the new password everywhere below. Never commit `.env` to git.

## Why backend + engine deploy together
`backend/index.js` spawns `etl_engine` as a **local child process** (`spawn(ENGINE_PATH, ...)`).
That means the C++ binary must live on the same machine/container as the Node backend —
you can't put them on separate serverless platforms. The frontend, however, is just a
static SPA and can be hosted anywhere (Vercel/Netlify) since it only talks to the backend over HTTP.

## What I changed
- `engine/CMakeLists.txt` already cross-platform — confirmed it **builds and links cleanly on Linux** (uses `find_package(PostgreSQL)` + `pthread`, no Windows-only code).
- `backend/index.js`: `ENGINE_PATH`/`ENGINE_CWD` no longer hardcode your Windows desktop path — they default to `./etl_engine` / `.`, overridable via env vars.
- `frontend/src/App.jsx`: `API` base URL now reads `import.meta.env.VITE_API_URL`, falling back to localhost for local dev.

## Option A — One VPS (DigitalOcean/AWS Lightsail/Oracle free tier), Docker (recommended)

1. Spin up an Ubuntu 22.04+ VPS, install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Copy this `deploy/` folder to the server (scp/git clone).
3. `cp .env.example .env` and fill in your **new** Neon credentials.
4. Build and run:
   ```bash
   docker compose up -d --build
   ```
   This builds the engine for Linux inside the container and starts the backend on port 3001.
5. Point a domain/Nginx reverse proxy (or just open port 3001) at the container.

### Cron — automatic scheduled runs
Set `RUN_PIPELINE_CRON` in `.env` to a standard cron expression, e.g.:
```
RUN_PIPELINE_CRON=0 */6 * * *   # every 6 hours
```
The container's entrypoint installs this into `cron` on boot and triggers
`cron/run_pipeline.sh`, which runs the engine **directly** (no HTTP round-trip) and
appends logs to `/app/cron/pipeline.log` (persisted via the `etl_logs` volume).
Remove the variable if you only want manual runs via the UI's "Run Pipeline" button.

If you'd rather not use Docker's internal cron, you can instead add this to the
**host's** crontab and call into the running container:
```bash
0 */6 * * * docker exec parallel_etl /app/cron/run_pipeline.sh
```

## Option B — Railway / Render (Docker-based PaaS)
Both support deploying directly from this `Dockerfile`:
1. Push this `deploy/` folder to a GitHub repo.
2. Railway: New Project → Deploy from repo → it auto-detects the Dockerfile.
   Render: New → Web Service → Docker → point at the repo.
3. Add the env vars from `.env.example` (with your rotated credentials) in the platform's dashboard.
4. For scheduled runs, use the platform's built-in **Cron Job** feature instead of in-container cron:
   Railway → Cron Job service running `bash /app/cron/run_pipeline.sh` on a schedule, sharing the same env vars.
   (This is cleaner than in-container cron on these platforms since they manage scheduling themselves.)

## Frontend
Deploy `frontend/` to Vercel/Netlify as a static Vite build:
```bash
cd frontend
npm install
echo "VITE_API_URL=https://your-backend-domain.com" > .env.production
npm run build
```
Deploy the `dist/` folder. Also update the backend's CORS config (`app.use(cors())` in
`backend/index.js`) to restrict `origin` to your frontend's domain once it's live —
right now it accepts requests from anywhere.

## Quick local test
```bash
cd deploy
cp .env.example .env   # fill in real (rotated) Neon creds
docker compose up --build
# backend: http://localhost:3001
# trigger one manual run: docker exec parallel_etl /app/cron/run_pipeline.sh
```
