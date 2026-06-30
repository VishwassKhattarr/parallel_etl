#!/bin/bash
set -e

# If RUN_PIPELINE_CRON is set (e.g. "0 */6 * * *"), install a crontab entry
# that triggers the ETL pipeline on that schedule, in addition to the
# on-demand "Run Pipeline" button in the web UI.
if [ -n "${RUN_PIPELINE_CRON:-}" ]; then
  echo "Installing cron schedule: ${RUN_PIPELINE_CRON}"
  # Persist the env vars cron needs (cron jobs run with a minimal env)
  printenv | grep -E '^(NEON_DB_URL|SOURCE_TABLE|DEST_TABLE|BATCH_SIZE|NUM_TRANSFORMERS|ENGINE_PATH|ENGINE_CWD|LOG_FILE)=' > /app/cron/cron.env

  echo "${RUN_PIPELINE_CRON} . /app/cron/cron.env; /app/cron/run_pipeline.sh" > /etc/cron.d/etl-pipeline
  echo "" >> /etc/cron.d/etl-pipeline
  chmod 0644 /etc/cron.d/etl-pipeline
  crontab /etc/cron.d/etl-pipeline
  cron
fi

# Start the backend (serves API; spawns the engine on-demand from the UI too)
exec node /app/backend/index.js
