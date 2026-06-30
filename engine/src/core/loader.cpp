#include "core/loader.h"
#include "utils/db_connection.h"
#include <iostream>
#include <sstream>
#include <vector>
#include <string>

static std::vector<std::string> splitRow(const std::string& row) {
    std::vector<std::string> fields;
    std::string field;
    for (char ch : row) {
        if (ch == FIELD_DELIM) { fields.push_back(field); field.clear(); }
        else field += ch;
    }
    fields.push_back(field);
    return fields;
}

// Escape single quotes so names like O'Brien don't break the SQL
static std::string esc(const std::string& v) {
    std::string out;
    for (char c : v) {
        if (c == '\'') out += "''";
        else out += c;
    }
    return out;
}

void loader(ThreadSafeQueue<DataChunk>& processedQueue,
            int totalTransformers,
            const std::string& connStr) {
    DBConnection db(connStr);
    if (!db.isConnected()) {
        std::cerr << "[loader] Cannot connect to dest DB\n";
        return;
    }

    int doneSignals = 0;
    int totalLoaded = 0;

    while (doneSignals < totalTransformers) {
        DataChunk chunk = processedQueue.pop();

        if (chunk.rows.empty()) {
            doneSignals++;
            std::cout << "[loader] done signal " << doneSignals
                      << "/" << totalTransformers << "\n";
            continue;
        }

        // Build one multi-row INSERT per chunk (fast, single round-trip)
        std::ostringstream q;
        q << "INSERT INTO processed_data "
          << "(id, name, department, total_compensation, experience_years, salary_category) "
          << "VALUES ";

        for (size_t i = 0; i < chunk.rows.size(); i++) {
            auto f = splitRow(chunk.rows[i]);
            if (f.size() < 6) continue;
            if (i > 0) q << ", ";
            // id (int), name (text), department (text),
            // total_compensation (numeric), experience_years (int), salary_category (text)
            q << "(" << f[0] << ", "
              << "'" << esc(f[1]) << "', "
              << "'" << esc(f[2]) << "', "
              << f[3] << ", "
              << f[4] << ", "
              << "'" << esc(f[5]) << "')";
        }
        q << " ON CONFLICT (id) DO NOTHING";

        if (db.executeVoid(q.str())) {
            totalLoaded += static_cast<int>(chunk.rows.size());
            std::cout << "[loader] inserted batch, total loaded: " << totalLoaded << "\n";
        } else {
            std::cerr << "[loader] batch insert failed\n";
        }
    }

    std::cout << "[loader] all done, total rows loaded: " << totalLoaded << "\n";
}