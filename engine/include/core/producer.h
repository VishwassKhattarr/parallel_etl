#ifndef PRODUCER_H
#define PRODUCER_H

#include "../utils/thread_safe_queue.h"
#include "../models/data_chunk.h"
#include <string>

void producer(ThreadSafeQueue<DataChunk>& rawQueue,
              const std::string& connStr,
              int batchSize);

#endif