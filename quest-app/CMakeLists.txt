cmake_minimum_required(VERSION 3.24)
project(HaloViewQuest VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Android NDK toolchain (set via CMAKE_TOOLCHAIN_FILE)
# Meta OpenXR SDK
set(OPENXR_SDK_DIR "" CACHE PATH "Path to Meta OpenXR Mobile SDK")

# Sources (to be added as development progresses)
# add_library(haloview-quest SHARED
#   src/main.cpp
#   src/xr/xr_session.cpp
#   src/xr/composition_layers.cpp
#   src/xr/passthrough.cpp
#   src/decode/video_decoder.cpp
#   src/input/hand_tracking.cpp
#   src/input/controller.cpp
#   src/streaming/stream_client.cpp
#   src/layout/spatial_anchors.cpp
# )

# target_include_directories(haloview-quest PRIVATE
#   ${CMAKE_SOURCE_DIR}/include
#   ${OPENXR_SDK_DIR}/OpenXR/Include
# )

# target_link_libraries(haloview-quest PRIVATE
#   android log mediandk OpenXR::openxr_loader
# )
