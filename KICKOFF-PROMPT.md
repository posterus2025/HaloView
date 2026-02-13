# Strix Halo VR -- Vibe Coding Platform: Session Kickoff Prompt

**Copy everything below the line into a new Claude Code session opened at `C:\Strix Halo VR`.**

---

## Prompt

I'm building a multi-window VR coding platform called **HaloView** that streams virtual desktops from my AMD Strix Halo laptop to a Meta Quest 3 headset over Wi-Fi 6E. The goal is a "vibe coding" environment -- AI-assisted development with 8-16 floating panels (VS Code, Claude chat, terminals, browser, docs) arranged spatially in VR.

### Hardware
- **CPU**: AMD Ryzen AI MAX+ PRO 395 (Zen 5, 16c/32t)
- **GPU**: Radeon 8060S integrated (RDNA 3.5, 40 CUs, 64GB VRAM from 128GB unified LPDDR5X)
- **Key advantage**: Zero-copy UMA (no PCIe bottleneck), dual VCN 4.0 with AV1 encode on both instances
- **Headset**: Meta Quest 3 (Snapdragon XR2 Gen 2, ~25 PPD, Wi-Fi 6E)

### Research completed
Read the viability study and AMD deep-dive in `docs/` before proceeding. Key findings:
- Quest 3's Horizon OS 3-panel limit is bypassed by running as an immersive OpenXR app
- OpenXR composition layers support ~12-16 panels natively, unlimited via tiled rendering
- AMF v1.5.0 supports 4:4:4 chroma (critical for text clarity)
- Dual VCN can encode two streams simultaneously (split-frame or per-panel)
- FSR 2.0 spatial upscaling is fine for VR; FSR 3.0 frame generation is NOT (adds ~11ms latency)
- ROCm 7.2 supports this APU for PyTorch (potential AI-enhanced features later)

### Architecture (two components)

**1. PC Companion (Windows, C++ or Rust)**
- Virtual Display Driver (IddSampleDriver) to create N virtual monitors
- DXGI Desktop Duplication API to capture each virtual monitor
- AMF encoder pipeline: capture -> optional FSR upscale -> H.265/AV1 encode via VCN
- Streaming server (WebRTC or custom QUIC/UDP) to transmit encoded frames + receive input
- Zero-copy UMA means capture/encode/send all happens in shared memory

**2. Quest 3 App (Native OpenXR, C++ with Meta OpenXR SDK)**
- Receive and decode video streams (MediaCodec hardware decode on XR2 Gen 2)
- Render each stream as an `XR_COMPOSITION_LAYER_QUAD` (composition layer = sharp text, no reprojection artifacts)
- Passthrough mode so user can see keyboard/desk
- Hand tracking + controller input for window management (grab, resize, arrange)
- Spatial anchors to persist window layout across sessions
- Input capture (keyboard, mouse) forwarded back to PC via data channel

### Development approach
Start with a **WebXR prototype** (2-4 weeks) to validate UX before committing to native. The prototype uses:
- WebRTC for streaming from PC
- A-Frame or Three.js for the VR scene
- Browser on Quest 3 (no sideloading needed)

Then build the native OpenXR version for production quality (composition layers, lower latency).

### Your task

**Read `docs/viability-study.md` and `docs/amd-technology-deep-dive.md` first**, then build a comprehensive master TODO list using TodoWrite that covers the entire project from prototype to production. Break it into these phases:

1. **Phase 0: Environment & Validation** -- Install tools, verify AMD VR streaming works with existing apps (Virtual Desktop), benchmark Wi-Fi throughput, confirm VCN encoding works
2. **Phase 1: WebXR Prototype** -- Browser-based MVP to validate multi-panel UX, WebRTC streaming from PC, basic window arrangement
3. **Phase 2: PC Companion App** -- Virtual display driver, DXGI capture, AMF encode pipeline, streaming server
4. **Phase 3: Native Quest 3 App** -- OpenXR app with composition layers, decode pipeline, input forwarding
5. **Phase 4: Integration & Polish** -- Connect PC companion to Quest app, optimize latency, add spatial anchors, layout presets
6. **Phase 5: Vibe Coding Features** -- AI chat panel integration, voice commands, code-aware layouts, LLM toggle (unload for VR, reload for AI)

For each phase, create specific, actionable TODO items. Include:
- What to build
- What technologies/SDKs to use
- What to test/validate at each step
- Dependencies between items

After creating the TODO list, scaffold the initial project structure (folders, configs, README) but don't write any application code yet. Set up:
- `prototype/` -- WebXR prototype
- `pc-companion/` -- Windows streaming server
- `quest-app/` -- Quest 3 OpenXR app
- `shared/` -- Protocol definitions, shared types
- `docs/` -- Already has research docs
- `tools/` -- Build scripts, benchmarking utilities

Let's go.
