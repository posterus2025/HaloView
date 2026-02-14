# HaloView - Multi-Window VR Coding Platform

## Current Status
<!-- Claude: update this section before ending any session -->
- **Phase:** 1 — VR Panel Interaction
- **Next task:** 1.1 — Grip + thumbstick Y = resize (InputManager.js, PanelManager.js)
- **Last completed:** Image quality fixed (XRQuadLayer primary), first commit pushed to posterus2025/HaloView
- **Last commit:** `bbecf30` — Initial commit
- **Roadmap:** See `docs/MASTER-PLAN.md` for full 5-phase plan
- **Checkpoint:** When user says "save checkpoint", update this section + commit

## Overview
Streams virtual desktops from AMD Strix Halo PC to Meta Quest 3 via WebRTC. Users select windows from within VR using a 3D picker — no manual screen sharing dialogs needed.

## Architecture

```
Quest 3 (browser)                    PC (Electron app)
┌─────────────────┐                 ┌──────────────────┐
│  VR Viewer       │  ◄─WebRTC──►  │  Electron Capture │
│  + WindowPicker  │                │  + desktopCapturer│
│  (Three.js)      │  ◄──WSS───►   │  (getUserMedia)   │
└────────┬─────────┘                └────────┬─────────┘
         │                                   │
         └────────► Signaling Server ◄───────┘
                    (ws://localhost:8080)
```

## Project Structure

```
prototype/
├── src/
│   ├── main.js                    # App entry — init scene, wire components
│   ├── vr/VRButton.js             # WebXR session button
│   ├── scene/
│   │   ├── PanelManager.js        # Create/arrange/remove streaming panels
│   │   └── WindowPicker.js        # 3D window picker overlay (curved card grid)
│   ├── input/InputManager.js      # VR controllers, laser pointer, grab/resize
│   ├── streaming/
│   │   ├── StreamClient.js        # Quest-side WebRTC (viewer role)
│   │   └── CaptureClient.js       # Browser capture fallback (unused with Electron)
│   └── signaling/server.js        # WebSocket signaling server (Node.js)
├── electron/
│   ├── main.js                    # Electron main process, tray, IPC
│   ├── preload.js                 # contextBridge for desktopCapturer
│   ├── lib/ElectronCaptureClient.js  # Programmatic window capture + WebRTC
│   └── renderer/capture-app.html  # PC monitoring dashboard
├── index.html                     # VR viewer entry point
├── capture.html                   # Browser capture fallback
├── vite.config.js                 # Vite config (HTTPS, /signal proxy)
└── package.json
```

## Running

```bash
# Terminal 1: Signaling server
cd prototype && npm run signal-server

# Terminal 2: Vite dev server (HTTPS for WebXR)
cd prototype && npm run dev

# Terminal 3: Electron capture app
cd prototype && npm run electron
```

Then open Quest 3 browser to `https://<PC-LAN-IP>:3000/` and enter VR.

## Key Design Decisions

### WebRTC Composite Keys
PeerConnections are keyed by `${peerId}:${panelId}` (not just peerId) to support multiple simultaneous streams between the same two peers.

### Signaling Protocol
Custom messages through the WebSocket signaling server:
- `window-list` — Electron broadcasts available windows with thumbnails
- `capture-window` — VR viewer requests capture of a specific window by sourceId
- `release-panel` — VR viewer tells Electron to stop a stream
- `request-window-list` — VR viewer asks for a fresh window list

### Electron Capture
Uses `desktopCapturer.getSources()` for window enumeration and `getUserMedia({ chromeMediaSourceId })` for programmatic capture — bypasses the OS screen-sharing dialog entirely.

### VR Interaction
- **Trigger** — click panels (forwarded to PC), select picker cards
- **Grip** — grab and move panels
- **Thumbstick** — resize (Y) and rotate (X) grabbed panels
- **A/X button** — toggle window picker
- **B/Y button** — exit VR

## VR Rendering — Lessons Learned

### XRQuadLayer is the PRIMARY rendering path
- XRQuadLayer bypasses the WebGL framebuffer entirely: `Video decode → XR compositor quad layer → display` (pixel-perfect, same pipeline as Quest system menus)
- VideoTexture path adds 3 extra sampling stages and is the main source of blur — only use as fallback when layers aren't supported
- When using VideoTexture fallback: mipmaps OFF (`generateMipmaps = false`, `minFilter = LinearFilter`) — mipmaps regenerate every frame AND sample lower levels at panel edges = blur

### Codec & Bitrate
- H.264 High profile preferred over VP8 for screen/text content (set via `setCodecPreferences`)
- 30Mbps minimum bitrate for crisp text at 2560x1440 (`priority: 'high'`, `degradationPreference: 'maintain-resolution'`)

### Panel Geometry & Layout
- Spherical-section geometry (not flat PlaneGeometry) for uniform texel density — prevents "dancing edges" aliasing
- `curveRadius >= 2.5m` for subtle curvature (0.9m is way too aggressive)
- Multi-panel arc: 60° max (keeps panels in comfortable forward view)
- Panel distance <= 1.0m for text readability
- Framebuffer scale factor 1.5 (150% native for supersampling)

### Controller Interaction
- Always call `controller.updateMatrixWorld(true)` before accessing `controller.matrixWorld` in event handlers — events fire before `renderer.render()` updates the scene graph

## Constraints (Proculus Coexistence)
This machine also runs Proculus (legal AI) at `C:\Proculus`. See `memory/proculus-constraints.md` for details:
- Never modify `C:\Proculus` or its dependencies
- VR streaming + LLM cannot coexist (write `UNLOAD` to model_target.txt first)
- Never install `optimum>=2.0`
