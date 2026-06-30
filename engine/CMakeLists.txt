cmake_minimum_required(VERSION 3.10)
project(parallel_etl_engine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(PostgreSQL REQUIRED)

add_executable(etl_engine
    src/main.cpp
    src/core/producer.cpp
    src/core/transformer.cpp
    src/core/loader.cpp
    src/utils/db_connection.cpp
)

target_include_directories(etl_engine PRIVATE
    include
    ${PostgreSQL_INCLUDE_DIRS}
)

target_link_libraries(etl_engine PRIVATE
    ${PostgreSQL_LIBRARIES}
    pthread
)