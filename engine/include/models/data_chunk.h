#ifndef DATA_CHUNK_H
#define DATA_CHUNK_H

#include <vector>
#include <string>

// ASCII Unit Separator — won't appear in real names/departments
constexpr char FIELD_DELIM = '\x1F';

struct DataChunk {
    std::vector<std::string> rows;
};

#endif