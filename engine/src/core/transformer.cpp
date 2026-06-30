#include "core/transformer.h"
#include <iostream>
#include <sstream>
#include <vector>
#include <string>

// ── helpers ────────────────────────────────────────────────────────────────

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

static std::string joinRow(const std::vector<std::string>& fields) {
    std::string out;
    for (size_t i = 0; i < fields.size(); i++) {
        if (i > 0) out += FIELD_DELIM;
        out += fields[i];
    }
    return out;
}

// join_date format from Postgres: "2018-03-15"
static int experienceYears(const std::string& joinDate) {
    if (joinDate.size() < 4) return 0;
    int joinYear = std::stoi(joinDate.substr(0, 4));
    return 2026 - joinYear;          // current year hardcoded — fine for now
}

static std::string salaryCategory(double salary) {
    if (salary <  70000.0) return "low";
    if (salary <= 100000.0) return "mid";
    return "high";
}

// ── thread function ────────────────────────────────────────────────────────

void transformer(ThreadSafeQueue<DataChunk>& rawQueue,
                 ThreadSafeQueue<DataChunk>& processedQueue,
                 int id) {
    int count = 0;

    while (true) {
        DataChunk chunk = rawQueue.pop();

        // Empty chunk = rawQueue closed and drained → this thread is done
        if (chunk.rows.empty()) break;

        DataChunk out;
        for (const auto& row : chunk.rows) {
            // incoming: id | name | department | salary | bonus | join_date
            auto f = splitRow(row);
            if (f.size() < 6) continue;

            double salary = std::stod(f[3]);
            double bonus  = std::stod(f[4]);
            double totalComp = salary + bonus;

            std::ostringstream tc;
            tc << std::fixed;
            tc.precision(2);
            tc << totalComp;

            std::vector<std::string> outFields = {
                f[0],                           // id
                f[1],                           // name
                f[2],                           // department
                tc.str(),                       // total_compensation
                std::to_string(experienceYears(f[5])),  // experience_years
                salaryCategory(salary)          // salary_category
            };
            out.rows.push_back(joinRow(outFields));
        }

        processedQueue.push(out);
        count += static_cast<int>(out.rows.size());
    }

    std::cout << "[transformer " << id << "] done, processed " << count << " rows\n";
    // Signal "I'm done" — empty chunk tells the loader this thread finished
    processedQueue.push(DataChunk{});
}