# ---- Stage 1: build the C++ ETL engine for Linux ----
FROM ubuntu:24.04 AS engine-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpq-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /engine
COPY engine/ .
RUN mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$(nproc)"

# ---- Stage 2: runtime image with Node backend + compiled engine ----
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 ca-certificates cron \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/

# Compiled engine binary
COPY --from=engine-build /engine/build/etl_engine /app/engine/etl_engine
RUN chmod +x /app/engine/etl_engine

# Cron script + crontab
COPY cron/ /app/cron/
RUN chmod +x /app/cron/run_pipeline.sh

ENV ENGINE_PATH=/app/engine/etl_engine
ENV ENGINE_CWD=/app/engine
ENV PORT=3001

EXPOSE 3001

COPY cron/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
