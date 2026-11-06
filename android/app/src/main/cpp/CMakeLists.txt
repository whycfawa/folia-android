cmake_minimum_required(VERSION 3.22.1)
project(folia_vulkan)

add_library(folia_vulkan SHARED vulkan_stage.cpp)

find_library(vulkan-lib vulkan)
find_library(android-lib android)
find_library(log-lib log)

target_link_libraries(folia_vulkan ${vulkan-lib} ${android-lib} ${log-lib})
