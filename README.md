# HaloView — Multi-Window VR Coding Platform

Stream 8-16 virtual desktop panels from an AMD Strix Halo laptop to a Meta Quest 3 headset over Wi-Fi 6E. A "vibe coding" environment with floating VS Code, Claude chat, terminals, browser, and docs arranged spatially in VR.

## Architecture

```
┌─────────────────────────────┐         Wi-Fi 6E          ┌──────────────────────┐
│      PC Companion           │  ◄──── H.265/AV1 ────►   │   Quest 3 App        │
│      (Windows, C++)         │  ◄──── Input events ──►   │   (OpenXR, C++)      │
│                             │                            │                      │
│  Virtual Display Driver     │                            │  Composition Layers  │
│  DXGI Desktop Duplication   │                            │  Video Decode        │
│  AMF Encode (Dual VCN 4.0)  │                            │  Hand/Controller     │
│  Streaming Server           │                            │  Spatial Anchors     │
└─────────────────────────────┘                            └──────────────────────┘
```

## Hardware

| Component | Spec |
|-----------|------|
| CPU | AMD Ryzen AI MAX+ PRO 395 (Zen 5, 16c/32t) |
| GPU | Radeon 8060S (RDNA 3.5, 40 CUs, 64 GB VRAM from 128 GB UMA) |
| Encode | Dual VCN 4.0 with AV1 on both instances |
| Headset | Meta Quest 3 (XR2 Gen 2, ~25 PPD, Wi-Fi 6E) |

## Project Structure

```
prototype/       WebXR browser-based prototype (Three.js + Vite)
pc-companion/    Windows streaming server (C++, AMF, DXGI)
quest-app/       Quest 3 native OpenXR app (C++, Meta SDK)
shared/          Protocol definitions, shared types
docs/            Research docs (viability study, AMD deep-dive)
tools/           Build scripts, benchmarking utilities
```

## Development Phases

0. **Environment & Validation** — Install tools, benchmark hardware, verify VCN encoding
1. **WebXR Prototype** — Browser-based MVP to validate multi-panel UX
2. **PC Companion App** — Virtual display driver, DXGI capture, AMF encode pipeline
3. **Native Quest 3 App** — OpenXR composition layers, decode, input forwarding
4. **Integration & Polish** — End-to-end optimization, spatial anchors, layout presets
5. **Vibe Coding Features** — AI chat panel, voice commands, code-aware layouts

## Key Technical Decisions

- **AMF v1.5.0+** for 4:4:4 chroma subsampling (critical for text clarity)
- **FSR 2.0** for upscaling (FSR 3.0 frame gen adds ~11ms latency — causes VR nausea)
- **OpenXR composition layers** bypass Quest 3's 3-panel Horizon OS limit (12-16 panels)
- **Zero-copy UMA** saves 3-6ms per frame (27-54% of 11.1ms budget at 90 Hz)
- **LLM must be unloaded** before VR streaming (shared memory bandwidth with Proculus)

## Coexistence with Proculus

This machine also runs Proculus (legal AI platform). Before starting VR streaming:
1. Write `UNLOAD` to `C:\Proculus\docs\model_target.txt` to free ~35 GB of VRAM
2. Verify the LLM server has stopped (port 8010 should be free)
3. After VR session, write `TEXT` to reload the LLM

See `docs/viability-study.md` and `docs/amd-technology-deep-dive.md` for research.
