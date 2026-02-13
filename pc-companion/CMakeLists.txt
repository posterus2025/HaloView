cmake_minimum_required(VERSION 3.24)
project(HaloViewCompanion VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# AMF SDK (Advanced Media Framework)
# Download from: https://github.com/GPUOpen-LibrariesAndSDKs/AMF
set(AMF_SDK_DIR "" CACHE PATH "Path to AMF SDK")

# Vulkan SDK
find_package(Vulkan REQUIRED)

# Sources (to be added as development progresses)
# add_executable(haloview-companion
#   src/main.cpp
#   src/capture/dxgi_capture.cpp
#   src/encode/amf_encoder.cpp
#   src/display/virtual_display.cpp
#   src/streaming/stream_server.cpp
# )

# target_include_directories(haloview-companion PRIVATE
#   ${CMAKE_SOURCE_DIR}/include
#   ${AMF_SDK_DIR}/amf/public/include
#   ${Vulkan_INCLUDE_DIRS}
# )

# target_link_libraries(haloview-companion PRIVATE
#   Vulkan::Vulkan
#   d3d11 dxgi
# )
