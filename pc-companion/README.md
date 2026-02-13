# HaloView PC Companion

Windows streaming server that captures virtual desktops and encodes them for the Quest 3.

## Pipeline
```
Virtual Display (IddSampleDriver)
    → DXGI Desktop Duplication (zero-copy capture)
    → AMF Encoder (H.265/AV1 via dual VCN 4.0, 4:4:4 chroma)
    → Streaming Server (QUIC/WebRTC)
    → Quest 3
```

## Dependencies
- Visual Studio 2022 (MSVC v143+)
- CMake 3.24+
- Vulkan SDK
- AMF SDK v1.5.0+ (for 4:4:4 chroma)
- IddSampleDriver (Microsoft sample indirect display driver)

## Build
```bash
cmake -B build -G "Visual Studio 17 2022"
cmake --build build --config Release
```

## Structure
```
src/
  capture/     DXGI Desktop Duplication
  encode/      AMF encoder pipeline (dual VCN, split-frame)
  display/     Virtual display driver management (IddSampleDriver)
  streaming/   QUIC/WebRTC transport
  control/     API for Quest app to manage panels
include/       Public headers
cmake/         CMake modules (FindAMF, etc.)
```

## Warning: Proculus Coexistence
This app shares the GPU with Proculus (legal AI platform).
Before running, ensure the LLM is unloaded (`UNLOAD` in model_target.txt).
VCN encode hardware is NOT used by Proculus, so encoding is safe to run.
The conflict is memory bandwidth on the shared UMA bus.
