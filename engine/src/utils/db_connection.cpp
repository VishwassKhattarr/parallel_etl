#include "utils/db_connection.h"
#include <iostream>

DBConnection::DBConnection(const std::string& connStr) {
    conn = PQconnectdb(connStr.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        std::cerr << "DB connection failed: " << PQerrorMessage(conn) << "\n";
        PQfinish(conn);
        conn = nullptr;
    }
}

DBConnection::~DBConnection() {
    if (conn) PQfinish(conn);
}

bool DBConnection::isConnected() const {
    return conn != nullptr && PQstatus(conn) == CONNECTION_OK;
}

PGresult* DBConnection::execute(const std::string& query) {
    if (!isConnected()) return nullptr;
    PGresult* res = PQexec(conn, query.c_str());
    ExecStatusType status = PQresultStatus(res);
    if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK) {
        std::cerr << "Query failed: " << PQerrorMessage(conn) << "\n";
        PQclear(res);
        return nullptr;
    }
    return res;
}

bool DBConnection::executeVoid(const std::string& query) {
    PGresult* res = execute(query);
    if (!res) return false;
    PQclear(res);
    return true;
}