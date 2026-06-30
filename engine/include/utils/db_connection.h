#ifndef DB_CONNECTION_H
#define DB_CONNECTION_H

#include <libpq-fe.h>
#include <string>

class DBConnection {
private:
    PGconn* conn;

public:
    DBConnection(const std::string& connStr);
    ~DBConnection();

    // Returns nullptr on failure (caller must check)
    PGresult* execute(const std::string& query);

    // Execute and expect no result rows (INSERT/UPDATE/CREATE)
    bool executeVoid(const std::string& query);

    bool isConnected() const;
};

#endif
