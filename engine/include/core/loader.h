#ifndef LOADER_H
#define LOADER_H

#include "../utils/thread_safe_queue.h"
#include "../models/data_chunk.h"
#include <string>

void loader(ThreadSafeQueue<DataChunk>& processedQueue,
            int totalTransformers,
            const std::string& connStr);

#endif