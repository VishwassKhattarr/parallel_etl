#ifndef THREAD_SAFE_QUEUE_H
#define THREAD_SAFE_QUEUE_H

#include <queue>
#include <mutex>
#include <condition_variable>
#include <optional>

template <typename T>
class ThreadSafeQueue {
private:
    std::queue<T> q;
    std::mutex mtx;
    std::condition_variable cv;
    bool closed = false;

public:
    void push(const T& item) {
        std::unique_lock<std::mutex> lock(mtx);
        q.push(item);
        cv.notify_one();
    }

    T pop() {
        std::unique_lock<std::mutex> lock(mtx);
        cv.wait(lock, [this] { return !q.empty() || closed; });
        if (q.empty()) return T{};  // queue closed, return default
        T item = q.front();
        q.pop();
        return item;
    }

    // Try to pop without blocking; returns nullopt if queue is empty
    std::optional<T> try_pop() {
        std::unique_lock<std::mutex> lock(mtx);
        if (q.empty()) return std::nullopt;
        T item = q.front();
        q.pop();
        return item;
    }

    void close() {
        std::unique_lock<std::mutex> lock(mtx);
        closed = true;
        cv.notify_all();
    }

    bool empty() {
        std::unique_lock<std::mutex> lock(mtx);
        return q.empty();
    }

    size_t size() {
        std::unique_lock<std::mutex> lock(mtx);
        return q.size();
    }
};

#endif
