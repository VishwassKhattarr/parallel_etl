#include "core/producer.h"
#include "utils/db_connection.h"
#include <iostream>
#include <sstream>

void producer(ThreadSafeQueue<DataChunk>& rawQueue,
              const std::string& connStr,
              int batchSize) {
    DBConnection db(connStr);
    if (!db.isConnected()) {
        std::cerr << "[producer] Cannot connect to source DB\n";
        rawQueue.close();
        return;
    }

    int offset = 0;
    int totalRows = 0;

    while (true) {
        std::ostringstream q;
        q << "SELECT id, name, department, salary, bonus, join_date "
          << "FROM source_data "
          << "ORDER BY id "
          << "LIMIT " << batchSize << " OFFSET " << offset;

        PGresult* res = db.execute(q.str());
        if (!res) break;

        int rowCount = PQntuples(res);
        if (rowCount == 0) {
            PQclear(res);
            break;
        }

        DataChunk chunk;
        int cols = PQnfields(res);
        for (int i = 0; i < rowCount; i++) {
            std::string row;
            for (int c = 0; c < cols; c++) {
                if (c > 0) row += FIELD_DELIM;
                row += PQgetvalue(res, i, c);
            }
            chunk.rows.push_back(row);
        }
        PQclear(res);

        totalRows += rowCount;
        offset    += batchSize;
        rawQueue.push(chunk);
        std::cout << "[producer] pushed batch, rows so far: " << totalRows << "\n";
    }

    std::cout << "[producer] done, total rows read: " << totalRows << "\n";
    rawQueue.close();
}