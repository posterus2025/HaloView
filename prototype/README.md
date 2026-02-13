# HaloView WebXR Prototype

Browser-based MVP to validate multi-panel VR UX before building native OpenXR.

## Stack
- **VR Scene**: Three.js with WebXR
- **Streaming**: WebRTC (PC screen capture to Quest 3 browser)
- **Signaling**: Node.js WebSocket server (LAN only)
- **Build**: Vite

## Setup
```bash
npm install
npm run dev          # Start Vite dev server (HTTPS, accessible on LAN)
npm run signal-server # Start WebRTC signaling server
```

Open `https://<PC-IP>:3000` in Quest 3 browser, enter VR.

## Structure
```
src/
  scene/       Three.js VR scene, panel management
  streaming/   WebRTC client, video texture mapping
  input/       Controller input capture, forwarding
  signaling/   WebSocket signaling server (Node.js)
public/        Static assets
```
