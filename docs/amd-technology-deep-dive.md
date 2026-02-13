# AMD Technology Deep Dive: Strix Halo for VR Streaming

*Supporting research for the Vibe Coding VR Platform*

---

## ROCm 7.2 on Strix Halo

### GPU Target

Strix Halo's RDNA 3.5 iGPU uses LLVM target `gfx1151`. Not individually listed in the main ROCm compatibility matrix, but ROCm 7.2 explicitly added **Ryzen APU support** and specifically names the **Ryzen AI Max 300 Series** (which IS Strix Halo).

### Supported ROCm targets (v7.2)

| Architecture | LLVM Targets |
|---|---|
| CDNA 2/3/4 | gfx90a, gfx908, gfx942, gfx950 |
| RDNA 4 | gfx1200, gfx1201 (Navi 4x) |
| RDNA 3 | gfx1100, gfx1101 (Navi 3x) |
| RDNA 2 | gfx1030 (Navi 2x) |
| **Ryzen APUs** | **AI Max 300 Series (Strix Halo)** |

### Windows ROCm (HIP SDK)

| Component | Windows Status |
|---|---|
| HIP Runtime (amdhip64) | Available |
| HIP Compiler (amd_comgr) | Available |
| PyTorch (Ryzen APUs) | Supported |
| TensorFlow | NOT available (Linux only) |
| JAX | NOT available (Linux only) |
| ONNX Runtime | NOT available natively (via WSL) |

WSL 2 support gives access to the full Linux ROCm stack from Windows.

### Non-ROCm Compute APIs (via Adrenalin driver)

- **OpenCL 2.1**: Fully supported
- **Vulkan 1.3**: Fully supported
- **DirectX 12 (FL 12_2)**: Fully supported
- **Shader Model 6.7**: Supported

---

## AMF (Advanced Media Framework) Details

### Encode Capabilities

- H.264 (AVC): Up to 4K @ 8-bit
- H.265 (HEVC): Up to 8K @ 10-bit
- AV1: Up to 8K @ 10-bit (VCN 4.0+)

### VR-Relevant Features by Version

| AMF Version | Feature | VR Application |
|---|---|---|
| v1.4.24 | Direct Capture mode | Low-latency screen/surface capture |
| v1.4.24 | HQScaler with FSR | Render low-res, upscale during encode |
| v1.4.24+ | Pre-analysis | Better quality in high-motion (head movement) scenes |
| v1.4.32+ | Frame Rate Conversion | Smooth 30fps desktop to 60-90fps for VR |
| v1.4.35 | Split frame encoding | Parallel encode across VCN instances |
| v1.4.35 | Multi-HW instance mode | Both VCN instances concurrently |
| v1.4.36 | B-frame support for AV1 | Better quality at same bitrate |
| v1.5.0 | 4:4:4 / 4:2:2 chroma | Critical for text clarity in virtual desktops |

### Strix Halo VCN Comparison with Other APUs

| APU | VCN Version | Instances | AV1 Encode |
|---|---|---|---|
| Cezanne (Ryzen 5xxx) | 2.0 | 1 | No |
| Rembrandt (Ryzen 6xxx) | 3.1 | 1 | No |
| Phoenix (Ryzen 8xxx) | 4.0 | 1 | Yes (1 instance) |
| **Strix Halo** | **4.0** | **2** | **Yes (BOTH instances)** |

> "AV1 encoder supported in one VCN instance only, except Strix Halo where it is supported on both."
> -- AMF Wiki

---

## VCN 4.0 Quality Notes

- H.264 B-frame support restored (absent since VCE 3.0 through VCN 2.x)
- Quality described as "nearly equivalent" to Intel Quick Sync and NVIDIA NVENC at matched bitrates
- Pre-analysis support since VCN 2.0

---

## FSR for VR: What Works and What Doesn't

### FSR 2.0 Temporal Upscaling -- YES

- Render at lower resolution (e.g., 1920x1920 per eye instead of 2880x2880), upscale with FSR 2.0
- Saves ~55% of pixel shading work
- Minimal added latency
- Integrated into AMF via HQScaler -- no separate pass needed
- Can encode the lower-res pre-upscale image, transmit it, upscale on decode end

### FSR 3.0 Frame Generation -- NO for VR

- Adds ~11ms latency (one frame at 90Hz)
- Head movement during delay causes mis-prediction and motion sickness
- **Exception**: For virtual desktop content (not head-tracked), could smooth 30fps to 90fps
- AMD Fluid Motion Frames (AFMF) has the same latency concern

---

## Unified Memory Architecture (UMA) Analysis

### Zero-Copy Pipeline

```
Discrete GPU:  CPU -> [PCIe 2-4ms] -> GPU render -> GPU encode -> [PCIe 1-2ms] -> CPU -> network
Strix Halo:    CPU -> GPU render -> GPU encode -> CPU -> network  (all shared memory)
```

Saves 3-6ms per frame. At 90Hz (11.1ms budget), that's 27-54% of the budget.

### Memory Layout

| Pool | Size | Role |
|---|---|---|
| VRAM carveout | 64 GB | GPU textures, render targets, encode buffers |
| OS RAM | 64 GB | CPU workloads, OS, applications |
| MALL cache | 32 MB | GPU-dedicated L3, frequently-accessed textures |
| L2 cache | 8 MB | GPU working set |

### VRAM Capacity for Virtual Desktops

- 4K RGBA desktop texture: ~33 MB
- 20 triple-buffered windows with mipmaps: <10 GB
- High-quality VR environment: 2-4 GB
- ML models (AI upscaling): 50-200 MB
- **Headroom remaining**: ~50 GB (without LLM loaded)

---

## LiquidVR SDK -- Legacy but Architecturally Informative

**Status: Dead. Last updated ~2017. DX11 only.**

### Concepts Still Relevant (Now Native in Vulkan/DX12)

| LiquidVR Feature | Modern Equivalent |
|---|---|
| Late-Latch | Vulkan/DX12 timeline semaphores |
| Async Compute | DX12/Vulkan async compute queues |
| Motion Estimation | OpenXR reprojection / ASW |
| Multi-GPU Affinity | N/A (single GPU on APU) |
| Direct-to-Display | OpenXR direct mode |

### True Audio Next (TAN)

- GPU-accelerated spatial audio via OpenCL
- Convolution reverb, room acoustics, HRTF processing
- Available on GPUOpen
- Directly relevant for immersive VR audio

---

## Recommended Technology Stack

```
Layer 1 - VR Runtime:     OpenXR (via SteamVR or Monado)
Layer 2 - Rendering:      Vulkan 1.3 (compositing, distortion, virtual displays)
Layer 3 - Encoding:       AMF (H.265 or AV1 via dual VCN 4.0)
Layer 4 - Transport:      Custom UDP / WebRTC / QUIC
Layer 5 - ML (optional):  HIP SDK / PyTorch ROCm (AI upscaling, tracking)
Layer 6 - Audio:          True Audio Next (OpenCL) or CPU-based HRTF
```
