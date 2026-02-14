# HaloView — Master Plan & Roadmap

> Living document. Updated each session. Claude reads this on wakeup to resume work.

---

## Status: Phase 1 In Progress

**Last updated:** 2026-02-13
**Last session:** Image quality fixed (XRQuadLayer primary), pushed first commit to `posterus2025/HaloView`

---

## Architecture Overview

```
Quest 3 (browser)                         PC (Electron + services)
┌──────────────────────┐                 ┌─────────────────────────┐
│  VR Viewer (Three.js) │  ◄─WebRTC──►  │  Electron Capture App   │
│  + WindowPicker       │                │  + desktopCapturer      │
│  + InputManager       │                │                         │
│  + Quest Mic ──────────── audio trk ──►│  Whisper STT (NPU) ────►│─► VS Code Extension
│                        │                │  (ONNX + Vitis AI EP)  │   (WebSocket cmd relay)
└────────┬───────────────┘                └────────┬───────────────┘
         │                                         │
         └──────────► Signaling Server ◄───────────┘
                      (ws://localhost:8080)
```

---

## Phases

### Phase 1: VR Panel Interaction (Current)
Fix how users manipulate virtual panels in VR space.

| # | Task | Status | Details |
|---|------|--------|---------|
| 1.1 | Grip + thumbstick Y = resize (single-hand) | `DONE` | Remap: Y=scale, X=push/pull. Aspect-locked. Clamp 0.3–1.8m. Throttled geometry rebuild + scale preview. |
| 1.2 | Two-handed pinch-to-resize | `TODO` | Both grips on same panel → scale by inter-hand distance. Move to midpoint. Release one → single-hand grab. |
| 1.3 | Interaction mode toggle | `DONE` | A/X long-press (500ms) toggles Move/Interact. Laser: blue (move) / orange (interact). Trigger gated by mode. |
| 1.4 | Update HUD to show current mode | `DONE` | Mode badge on wrist HUD (blue MOVE / orange INTERACT). Control labels update per mode. |
| 1.5 | Mouse+keyboard controls windows on PC | `DONE` | Move mode: trigger/mousemove/scroll disabled on panels. Interact mode: forwarded to PC. |

**Files to modify:**
- `prototype/src/input/InputManager.js` — mode toggle, resize logic, two-hand grab
- `prototype/src/scene/PanelManager.js` — `resizePanel()` method, min/max constants

---

### Phase 2: Voice Command Pipeline
Stream Quest mic audio to PC, transcribe via NPU, relay to VS Code.

| # | Task | Status | Details |
|---|------|--------|---------|
| 2.1 | Quest mic capture | `TODO` | `getUserMedia({ audio: true })` BEFORE entering VR (permission dialog). Add audio track to existing PeerConnection. |
| 2.2 | PC-side audio receiver | `TODO` | Electron receives audio track via WebRTC `ontrack`. Extract audio frames for STT. |
| 2.3 | Whisper STT on NPU | `TODO` | Install `onnxruntime-vitis-ai`. Use `amd/whisper-base-onnx-npu` model. NO optimum, NO transformers. Real-time transcription on XDNA 2 (50+ TOPS). |
| 2.4 | VS Code extension (WebSocket relay) | `TODO` | Extension listens on `ws://localhost:8889`. Receives transcribed commands as JSON. Shows approval dialog. Executes on confirm. |
| 2.5 | VR toggle: voice mode on/off | `TODO` | Button in VR to start/stop mic streaming. Visual indicator (mic icon on HUD). |
| 2.6 | Voice-triggered bat commands | `TODO` | Whisper recognizes "wakeup" → runs `wakeup.bat`, "save checkpoint" → runs `checkpoint.bat`. Local hotword detection. |

**Files to create/modify:**
- `prototype/src/streaming/StreamClient.js` — add audio track to PeerConnection
- `prototype/electron/lib/AudioReceiver.js` — NEW: receive WebRTC audio, feed to Whisper
- `prototype/electron/lib/WhisperNPU.js` — NEW: ONNX Runtime Whisper inference
- `vscode-extension/` — NEW: VS Code extension project
- `prototype/src/input/InputManager.js` — mic toggle button

**Dependencies:**
- AMD Ryzen AI Software v1.7+
- `onnxruntime-vitis-ai` (pip, isolated from Proculus)
- `amd/whisper-base-onnx-npu` model from HuggingFace

**Constraints:**
- NEVER install `optimum>=2.0` (breaks Proculus)
- NPU only (GPU stays free for VR streaming)
- Request mic permission BEFORE entering immersive VR mode

---

### Phase 3: VS Code Integration
Deep integration between VR workspace and VS Code.

| # | Task | Status | Details |
|---|------|--------|---------|
| 3.1 | Voice dictation → editor | `TODO` | Transcribed text inserted at cursor. Uses VS Code Speech extension or custom. |
| 3.2 | Voice commands → actions | `TODO` | "Run tests", "save file", "open terminal" → mapped to VS Code commands. Approval dialog for destructive ops. |
| 3.3 | Click-to-approve in VR | `TODO` | VR overlay shows pending command. Trigger click to approve/deny. Result relayed back to VS Code extension. |
| 3.4 | Bidirectional status | `TODO` | VS Code extension sends status back to VR (build pass/fail, test results) displayed on HUD or floating panel. |

---

### Phase 4: Multi-Monitor & Layout
Production-ready workspace management.

| # | Task | Status | Details |
|---|------|--------|---------|
| 4.1 | Workspace save/restore | `TODO` | Save panel positions, sizes, which windows are captured. Restore on next VR session. |
| 4.2 | Snap zones | `TODO` | Predefined positions: center, left, right, above. Snap-to when dragging near. |
| 4.3 | Panel grouping | `TODO` | Group panels that move together (e.g., editor + terminal). |
| 4.4 | Quick-switch layouts | `TODO` | Thumbstick click cycles through saved layouts. |

---

### Phase 5: Performance & Polish

| # | Task | Status | Details |
|---|------|--------|---------|
| 5.1 | Zero-copy UMA path | `TODO` | AMD-specific: skip GPU upload for video frames. Saves 3-6ms/frame. |
| 5.2 | Dual VCN encoding | `TODO` | Use both VCN 4.0 engines for parallel panel encoding (AV1). |
| 5.3 | Adaptive bitrate | `TODO` | Monitor RTT, adjust bitrate per-panel based on content change rate. |
| 5.4 | Hand tracking fallback | `TODO` | Quest 3 hand tracking as alternative to controllers. |

---

## Completed Work

| Date | What | Commit |
|------|------|--------|
| 2026-02-13 | Initial prototype: Electron capture, WebRTC streaming, VR viewer, WindowPicker | `bbecf30` |
| 2026-02-13 | Image quality fix: XRQuadLayer primary, H.264 preference, mipmaps off, 60° arc | `bbecf30` (same commit) |
| 2026-02-13 | Controller fix: `updateMatrixWorld(true)` before matrixWorld access in events | `bbecf30` |
| 2026-02-13 | Pushed to `posterus2025/HaloView` on GitHub | — |

---

## Research Findings (Reference)

### VR Panel Resize
- Quest native UI: single-hand corner-handle drag (not two-hand)
- Virtual Desktop: single grip=move, both grips=resize, grip+thumbstick=size/distance
- UX study: users prefer one-handed (25-person study), two-handed more precise
- Recommendation: implement single-hand first (thumbstick Y=scale), two-hand second

### Quest Mic → STT
- `getUserMedia({ audio: true })` works in Quest browser (Chromium 128+)
- Must request BEFORE entering VR (permission dialog won't render in immersive)
- Best path: add audio track to existing PeerConnection (~20-50ms latency)
- 48kHz mono, Opus codec

### AMD XDNA 2 NPU for Whisper
- Officially supported: AMD published guide for Whisper on Ryzen AI NPUs
- Pre-quantized: `amd/whisper-base-onnx-npu` on HuggingFace
- Runtime: ONNX Runtime + Vitis AI EP (no optimum, no transformers — Proculus-safe)
- 50+ TOPS on Strix Halo XDNA 2, handles real-time STT
- Whisper base/small/medium supported; large exceeds NPU limits

### VS Code Integration
- WCMD extension: WebSocket on `ws://localhost:5813` for external commands
- Custom extension: `vscode.commands.executeCommand()` + `showInformationMessage()` for approval
- VS Code Speech extension: built-in offline dictation (26 languages)
- Recommended: custom extension with WebSocket + approval dialog
