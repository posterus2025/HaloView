# HaloView Quest 3 App

Native OpenXR application for Meta Quest 3 that receives video streams and renders them as floating composition layer panels in VR.

## Features
- 12-16 composition layer quads (sharp text, no reprojection artifacts)
- Passthrough mode (see keyboard/desk)
- Hand tracking + controller input
- Spatial anchors (persist layout across sessions)
- Hardware video decode (MediaCodec on XR2 Gen 2)

## Dependencies
- Android NDK r26+
- Meta OpenXR Mobile SDK
- CMake 3.24+

## Build
```bash
# Configure with Android toolchain
cmake -B build \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-29 \
  -DOPENXR_SDK_DIR=/path/to/ovr_openxr_mobile_sdk

cmake --build build
```

## Structure
```
src/
  xr/          OpenXR session lifecycle, composition layers, passthrough
  decode/      MediaCodec video decoder, AHardwareBuffer mapping
  input/       Hand tracking, controller input, keyboard/mouse forwarding
  streaming/   QUIC/WebRTC stream receiver
  layout/      Spatial anchors, layout presets, panel management
include/       Public headers
cmake/         CMake modules
```
