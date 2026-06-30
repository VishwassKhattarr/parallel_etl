#!/bin/bash
# Runs the ETL pipeline directly against the configured Neon DB.
# Pulls config from environment (set these as container/host env vars
# or a sourced .env file — never hardcode credentials here).

set -euo pipefail

: "${NEON_DB_URL:?NEON_DB_URL is not set}"
export SOURCE_TABLE="${SOURCE_TABLE:-source_data}"
export DEST_TABLE="${DEST_TABLE:-processed_data}"
export BATCH_SIZE="${BATCH_SIZE:-30}"
export NUM_TRANSFORMERS="${NUM_TRANSFORMERS:-4}"

ENGINE_BIN="${ENGINE_PATH:-/app/engine/etl_engine}"
ENGINE_DIR="${ENGINE_CWD:-/app/engine}"
LOG_FILE="${LOG_FILE:-/app/cron/pipeline.log}"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting ETL pipeline run" >> "$LOG_FILE"
cd "$ENGINE_DIR"
"$ENGINE_BIN" >> "$LOG_FILE" 2>&1
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Finished with exit code $?" >> "$LOG_FILE"
