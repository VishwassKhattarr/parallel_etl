#ifndef TRANSFORMER_H
#define TRANSFORMER_H

#include "../utils/thread_safe_queue.h"
#include "../models/data_chunk.h"

void transformer(ThreadSafeQueue<DataChunk>& rawQueue,
                 ThreadSafeQueue<DataChunk>& processedQueue,
                 int id);

#endif