# AMD Strix Halo + Meta Quest 3: Vibe Coding Platform Viability Study

*Date: February 12, 2026*
*Hardware: AMD Ryzen AI MAX+ PRO 395, Radeon 8060S (RDNA 3.5, 40 CUs), 128 GB LPDDR5X UMA*

---

## Executive Summary

**Verdict: Viable today with off-the-shelf tools. Highly differentiated custom solution is buildable.**

The Strix Halo's dual VCN 4.0 encoders (both with AV1), 64GB VRAM, and zero-copy UMA architecture provide structural advantages over discrete GPU setups for multi-window VR streaming. Existing apps (Virtual Desktop, Immersed) work today. A purpose-built vibe coding platform is achievable in 3-6 months.

---

## 1. Connecting Strix Halo to Quest 3

### Existing Solutions (Ranked)

| Priority | Solution | Cost | AMD Support | Multi-Window |
|----------|----------|------|-------------|-------------|
| 1st | **Virtual Desktop** | $19.99 one-time | Full (AMF/AV1) | 3-5 screens |
| 2nd | **Immersed** | $7.99/mo (Pro) | Full (AMF) | Up to 5 screens |
| 3rd | **ALVR** | Free/open-source | Good (AMF + Vulkan encode) | Mirrors physical monitors |
| 4th | **Meta Air Link** | Free | Works, less polished | Mirrors physical monitors |

**Virtual Desktop** is the recommended starting point. Guy Godin actively optimizes for AMD GPUs, supports AV1 hardware encoding (which RDNA 3.5 VCN excels at), and includes SSW reprojection.

**Immersed** is the best pure-productivity option with up to 5 virtual monitors, passthrough keyboard tracking, and curved arrangements.

### iGPU Recognition Caveat

Meta Quest Link may fail to recognize the Radeon 8060S because its compatibility list targets discrete GPUs. Virtual Desktop and ALVR are more permissive about device IDs.

### Setup Requirements

1. **Unload the LLM first** -- write `UNLOAD` to `model_target.txt`. VR encoding + Llama-3.3-70B would fight over memory bandwidth.
2. **Wire the laptop to router via Ethernet**, Quest 3 on Wi-Fi 6/6E (5GHz or 6GHz band).
3. **Start with HEVC encoding**, experiment with AV1 if stable.
4. **SteamVR render resolution**: Start at 80-90% of Quest 3 native.
5. **Keep Adrenalin drivers current** -- Strix Halo is young silicon.

---

## 2. The 3-Window Limit and How to Break It

### The OS Limit

Meta Horizon OS enforces a **3 simultaneous 2D panel** limit at the compositor level. No setting, developer flag, or sideload hack reliably changes this.

### How Apps Bypass It

Third-party apps run as **immersive applications** that take over rendering entirely, then implement their own internal windowing compositor. The OS sees one app; internally it renders unlimited panels.

| App | Max Screens | Method |
|-----|-------------|--------|
| Immersed Pro | 5 | Internal compositor |
| Virtual Desktop | 3-5 | Mirrors physical + virtual monitors |
| Custom native OpenXR app | **~12-16** | Composition layers (runtime limit ~16) |
| Custom (tiled approach) | **Unlimited** | One large texture, UV-split across quads |

**Bottom line**: The 3-window limit is an OS constraint, not a hardware one. Any immersive app can render as many panels as it wants internally.

---

## 3. Why Strix Halo Is Uniquely Suited

### The Zero-Copy UMA Advantage

On a discrete GPU, VR streaming has a hidden tax:

```
CPU prepares data -> PCIe copy to GPU (2-4ms) -> GPU renders -> GPU encodes -> PCIe copy back (1-2ms) -> network send
```

On Strix Halo UMA:

```
CPU prepares data [shared memory] -> GPU renders [same memory] -> GPU encodes [same memory] -> network send
```

**Saves 3-6ms per frame.** At 90Hz (11.1ms frame budget), that's 27-54% of the budget recovered. No discrete GPU can match this for streaming workloads.

### Dual VCN 4.0 -- Unique Hardware Feature

Strix Halo is the **only APU with AV1 encode on both VCN instances**. Every other AMD APU has AV1 on one instance or not at all.

- Encode left eye + right eye as separate streams simultaneously
- Encode two independent virtual monitors in parallel
- AV1 provides ~30% better compression than H.265 at equivalent quality

### VCN 4.0 Codec Support

| Codec | Decode | Encode |
|---|---|---|
| H.264 (AVC) | 8-bit: 4K | 8-bit: 4K |
| H.265 (HEVC) | 8/10-bit: 8K | 8/10-bit: 8K |
| VP9 | 8/10-bit: 8K | N/A |
| AV1 | 8/10/12-bit: 8K | 8/10-bit: 8K |

### 64GB VRAM

A 4K desktop texture is ~33MB. Could hold **~2,000 virtual desktops** in VRAM. Even 20 triple-buffered windows with mipmaps would use <10GB. Discrete GPUs max at 24GB.

### 32MB MALL Cache

GPU-dedicated L3 cache holds frequently-accessed textures (virtual desktop surfaces, UI elements), partially offsetting the ~256 GB/s shared bandwidth vs. discrete GPU dedicated bandwidth (~1 TB/s).

### Comparison with Discrete GPUs

| Aspect | Strix Halo | RTX 4090 | Winner for VR Streaming |
|---|---|---|---|
| VRAM | 64 GB | 24 GB | Strix Halo |
| Memory bandwidth | ~256 GB/s (shared) | ~1 TB/s (dedicated) | Discrete |
| CPU-GPU transfer | Zero-copy | PCIe 4.0 (~32 GB/s) | **Strix Halo** |
| Shader performance | 2560 SPs, 40 CUs | 16384 SPs, 128 SMs | Discrete (6x more) |
| HW encode instances | 2 VCN (both AV1) | 2 NVENC (one AV1) | Equal |
| Total system power | ~120W TDP (entire SoC) | GPU alone: 350-450W | **Strix Halo** |
| System memory | 128 GB unified | Typically 64 GB + 24 GB separate | Strix Halo |

**Key insight:** For VR streaming, the bottleneck is encode latency and CPU-GPU transfer, not raw shader TFLOPS. Strix Halo wins where it matters for display virtualization.

---

## 4. AMD Technology Stack Assessment

### What's Useful

| Technology | Role | Maturity | Use? |
|------------|------|----------|------|
| **AMF** (Advanced Media Framework) | Video encode/decode pipeline | Production-ready | **Yes -- primary encode path** |
| **Vulkan 1.3 Compute** | Real-time compositing & rendering | Production-ready | **Yes -- rendering layer** |
| **UMA zero-copy** | Eliminate transfer latency | Hardware-level | **Yes -- always active** |
| **Dual VCN 4.0** | Parallel encode streams | Hardware-level, via AMF | **Yes -- core advantage** |
| **FSR 2.0 in AMF HQScaler** | Upscale lower-res renders | Available in AMF | **Yes -- reduce encode payload** |
| **ROCm/HIP** (v7.2) | ML inference (AI features) | Preview for APUs | **Maybe -- AI upscaling** |
| **True Audio Next** | Spatial VR audio | Available, OpenCL | **Nice-to-have** |

### What's NOT Useful

| Technology | Why Not |
|------------|---------|
| **LiquidVR SDK** | Dead since ~2017. Concepts (late-latch, async timewarp) now in Vulkan/DX12 natively |
| **FSR 3.0 Frame Gen** | Adds ~11ms latency -- causes nausea in head-tracked VR |
| **ROCm for rendering** | Use Vulkan/DX12 directly. ROCm is for ML workloads only |

### ROCm 7.2 Supports Strix Halo

As of January 2026, ROCm 7.2 explicitly lists **Ryzen AI Max 300 Series** for PyTorch. First official APU ROCm support. Framework coverage is narrower than discrete (PyTorch only on APUs vs. +TensorFlow +JAX on discrete), but sufficient for AI features.

### AMF Features Relevant to VR Streaming

- **Split-frame encoding** (v1.4.35): divide frames for parallel encode across both VCN instances
- **Multi-HW instance mode** (v1.4.35): use both VCN instances concurrently
- **4:4:4 chroma subsampling** (v1.5.0): critical for text clarity on virtual desktops
- **HQScaler with FSR**: upscale during encode pipeline, no separate pass needed
- **Frame rate conversion** (v1.4.32+): smooth 30fps desktop content to 90fps for VR

---

## 5. Quest 3 as a Coding Platform

### Text Readability

| Device | Pixels/Degree | Code Comfort |
|--------|--------------|--------------|
| Quest 3 | ~25 PPD | Workable at 14pt+ fonts |
| Apple Vision Pro | ~34 PPD | Very comfortable |
| Physical 27" 4K @ 60cm | ~60 PPD | Baseline |

Quest 3 is below the ~30 PPD comfort threshold for dense code, but **vibe coding changes the equation**. Conversing with AI and reviewing generated output is less demanding than reading dense code character-by-character. 25 PPD is adequate.

**Optimizations**: Dark themes, JetBrains Mono / Cascadia Code fonts, composition layers for sharp text, sharpening filters in Virtual Desktop / Immersed.

### Session Duration

- ~2-4 hours comfortable with good strap (replace stock -- BoboVR M3 Pro or Elite Strap)
- Battery: ~2 hours standalone. Use USB-C power or battery strap for extended sessions
- Break every 30-45 minutes

### Input

- **Physical keyboard**: Essential. Quest 3 passthrough shows it. Certain keyboards (Logitech, Apple Magic Keyboard) get enhanced tracking
- **Mouse**: Bluetooth, fully supported
- **Voice**: Natural fit for vibe coding -- describe intent verbally, AI generates code

---

## 6. Custom Build Architecture

### System Design

```
+-------------------------------------------------------+
|                Quest 3 (Native OpenXR App)              |
|                                                         |
|  +----------+ +----------+ +----------+                |
|  | VS Code  | | Claude   | | Terminal | ... (12-16)   |
|  | Panel    | | Chat     | | Panel    |                |
|  +----+-----+ +----+-----+ +----+-----+                |
|       |             |            |                      |
|       +-- Composition Layers (XR_COMPOSITION_LAYER_QUAD)|
|              OpenXR Runtime                             |
|         + Passthrough + Hand Tracking                   |
|         + Spatial Anchors (persistent layout)           |
+----------------------------+----------------------------+
                             | Wi-Fi 6E (H.265/AV1 streams)
                             | + WebRTC data channel (input)
+----------------------------+----------------------------+
|              Strix Halo PC Companion                    |
|                                                         |
|  +------------------+  +------------------------+      |
|  | Virtual Display   |  | DXGI Desktop Capture    |     |
|  | Driver (N mons)   |  | (per virtual monitor)   |     |
|  +--------+----------+  +-----------+------------+      |
|           |                         |                   |
|  +--------+-------------------------+----------+       |
|  |  AMF Encoder (Dual VCN 4.0)                 |       |
|  |  - AV1 or H.265, split-frame encoding       |       |
|  |  - HQScaler + FSR upscaling                 |       |
|  |  - 4:4:4 chroma for text clarity            |       |
|  |  - Zero-copy UMA (no PCIe overhead)         |       |
|  +-----------------------+---------------------+       |
|                          |                              |
|  +-----------------------+---------------------+       |
|  |  Streaming Server (WebRTC/QUIC/Custom UDP)  |       |
|  +---------------------------------------------+       |
+-------------------------------------------------------+
```

### Key Differentiators vs. Immersed

1. **No artificial 5-screen cap** -- 12-16 via composition layers, unlimited via tiled rendering
2. **Purpose-built for vibe coding** -- integrated AI chat panel, voice command routing, code-aware layouts
3. **AMD-optimized** -- dual VCN AV1, zero-copy UMA, AMF 4:4:4 chroma for text
4. **Layout presets** -- "Proculus mode" with specific panels pre-arranged
5. **LLM integration** -- direct tie-in to local Llama instance for on-device AI

### Development Components

- OpenXR composition layers (Quest SDK)
- Virtual Display Driver (IddSampleDriver, open-source)
- DXGI Desktop Duplication API
- AMF SDK (GPUOpen, well-documented)
- WebRTC or custom UDP streaming

### Timeline Estimate

- **WebXR prototype**: 2-4 weeks (browser-based, validates UX)
- **Native OpenXR MVP**: 3-6 months (full streaming pipeline)

---

## 7. What NOT To Do

- Don't use ROCm for the rendering/compositing pipeline -- use Vulkan or DX12 directly
- Don't use FSR 3.0 frame generation for VR -- the latency causes nausea
- Don't run the LLM simultaneously with VR streaming -- bandwidth contention on shared memory bus
- Don't bother with LiquidVR SDK -- dead since 2017, use modern Vulkan/OpenXR APIs
- Don't try to hack the Horizon OS 3-panel limit -- use an immersive app instead
- Don't install `optimum>=2.0` -- breaks transformers imports (same as Proculus constraint)

---

## 8. Source Technologies & References

- **AMF SDK**: https://github.com/GPUOpen-LibrariesAndSDKs/AMF
- **AMF HW Features**: https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/GPU-and-APU-HW-Features-and-Support
- **ROCm 7.2 Docs**: https://rocm.docs.amd.com/en/latest/
- **ROCm Radeon/Ryzen**: https://rocm.docs.amd.com/projects/radeon/en/latest/
- **OpenXR Spec**: https://registry.khronos.org/OpenXR/
- **Meta Quest Developer**: https://developer.oculus.com/
- **Virtual Desktop**: https://www.vrdesktop.net/
- **ALVR**: https://github.com/alvr-org/ALVR
- **Immersed**: https://immersed.com/
- **IddSampleDriver**: https://github.com/microsoft/Windows-driver-samples/tree/main/video/IndirectDisplay
- **DXGI Desktop Duplication**: https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api
