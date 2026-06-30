#include "core/producer.h"
#include "core/transformer.h"
#include "core/loader.h"
#include "utils/thread_safe_queue.h"
#include "models/data_chunk.h"

#include <iostream>
#include <thread>
#include <vector>
#include <chrono>
#include <cstdlib>
#include <string>

static std::string env(const char* name, const std::string& fallback = "") {
    const char* v = std::getenv(name);
    return v ? std::string(v) : fallback;
}

int main() {
    std::string connStr       = env("NEON_DB_URL");
    int         numTransformers = std::stoi(env("NUM_TRANSFORMERS", "4"));
    int         batchSize       = std::stoi(env("BATCH_SIZE", "10"));

    if (connStr.empty()) {
        std::cerr << "Set NEON_DB_URL environment variable first.\n";
        return 1;
    }

    std::cout << "Starting ETL pipeline with " << numTransformers
              << " transformer threads, batch size " << batchSize << "\n\n";

    ThreadSafeQueue<DataChunk> rawQueue;
    ThreadSafeQueue<DataChunk> processedQueue;

    auto t0 = std::chrono::steady_clock::now();

    // Start all threads
    std::thread prod(producer, std::ref(rawQueue), connStr, batchSize);

    std::vector<std::thread> workers;
    for (int i = 0; i < numTransformers; i++)
        workers.emplace_back(transformer, std::ref(rawQueue),
                             std::ref(processedQueue), i);

    std::thread load(loader, std::ref(processedQueue), numTransformers, connStr);

    // Wait for all to finish
    prod.join();
    for (auto& w : workers) w.join();
    load.join();

    double elapsed = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - t0).count();

    std::cout << "\nPipeline complete in " << elapsed << " seconds.\n";
    return 0;
}