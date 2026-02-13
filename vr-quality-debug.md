# HaloView VR Quality Regression & Missing Features — Root Cause Debug Guide

## Status as of 2026-02-13

### What the user saw when it was "clean"
After round 2 changes, user said **"its much cleaner now"** — they could read text on screen.
That build had: `framebufferScaleFactor(1.2)`, `contentHint='text'`, 15Mbps bitrate, `anisotropic filtering`, auto-captured primary display.

### What the user sees NOW (after round 3 changes)
- **"dancing edges along straight lines"** — temporal aliasing / shimmer (Moiré) on the video panel. This is the #1 regression.
- **Panel is massive** — "7ft x 4ft off to my right" even though code now uses head-relative placement
- **Super blurry** on large monitor (Screen 2)
- **No HUD** — the controls reference on left controller is invisible
- **No draggability** — grip/squeeze to grab panels doesn't work
- **No auto-capture** — has to pick from window list instead of auto-capturing primary display

### Files changed in round 3 (the regression round)
1. **`src/input/InputManager.js`** — Full rewrite. Head tracking, controls HUD, B/Y recenter, push/pull. ~755 lines.
2. **`src/scene/PanelManager.js`** — `arrangeCurved()` now takes `centerPos`/`facingDir` params. Added `recenterToHead()`.
3. **`src/main.js`** — Panel creation uses `getInFrontOfHead(1.2)` + rotation. Wired `onRecenter`.

### Capture side (`electron/lib/ElectronCaptureClient.js`) was NOT changed in round 3
The capture client still has: 2560x1440 for screens, 1920x1080 for windows, retry at 1280x720, 15Mbps bitrate, `contentHint='text'`. This is unchanged from the "clean" version.

---

## Root Cause Hypotheses

### 1. "Dancing edges" — temporal aliasing regression
**Most likely cause:** The `framebufferScaleFactor(1.2)` in main.js (line 103) is STILL present, so that's not the issue. Check if:
- The **panel physical size** is much larger now. `addDemoPanel` creates a 1.6x0.9m panel, but `attachStream()` auto-resizes in `loadedmetadata` to match video aspect. A 2560x1440 (16:9) video → 0.9 * (2560/1440) = 1.6m. Same as before. BUT if user picks a non-16:9 monitor (ultrawide?), it could be huge.
- The panel is **farther away** (1.2m vs 1.0m before). At 1.2m distance, the same physical panel subtends less angular FOV, meaning fewer pixels per degree → looks blurrier. **Try changing back to 1.0m** in `getInFrontOfHead()`.
- The `rotation` parameter on `addDemoPanel` could be misapplied. Check `PanelManager.addDemoPanel` — does `mesh.rotation.copy(rotation)` work when `rotation` is a `THREE.Euler`? **Yes, `Euler.copy(Euler)` works fine.**

**Quick fix to try:** Change `getInFrontOfHead(1.2)` calls to `getInFrontOfHead(0.9)` to bring panels closer.

### 2. Panel massive / off to right
The `getInFrontOfHead()` relies on `this._headPos` and `this._headDir` being correctly updated. These are initialized to `(0, 1.6, 0)` and `(0, 0, -1)`. They ONLY update in `update()`:
```javascript
if (this.renderer.xr.isPresenting) {
  const xrCam = this.renderer.xr.getCamera();
  xrCam.getWorldPosition(this._headPos);
  xrCam.getWorldDirection(this._headDir);
}
```
**PROBLEM:** The `onStream` callback fires when a WebRTC stream arrives — this happens asynchronously. If the XR session hasn't started yet, or if no `update()` has run yet, `_headPos` is still `(0, 1.6, 0)` and `_headDir` is `(0, 0, -1)`. The panel gets placed at world origin + offset, exactly like before!

**But wait:** The signaling + WebRTC handshake takes time, so `update()` should have run many frames before the stream arrives. Unless the stream arrives before VR is entered (user might be in 2D mode when auto-capture triggers, then enters VR and the panel is at (0, 1.6, -1.2) in world space — which is "off to the right" if they're facing a different direction in their room).

**Likely scenario:** Auto-capture fires on `onWindowList` (before VR is entered). Panel gets placed at default head pos. User enters VR facing arbitrary direction → panel is behind/beside them.

**Fix:** After XR session starts, trigger a recenter. Add to `sessionstart` handler in main.js:
```javascript
this.renderer.xr.addEventListener('sessionstart', () => {
  // Delay slightly to let head tracking initialize
  setTimeout(() => {
    this.inputManager._recenter();
  }, 500);
});
```

### 3. No HUD visible
The HUD is created in `setupControllers()` → `_createControlsHUD(this.controllers[0].controller)`. It's attached to controller index 0 as a child.

**Potential issues:**
- **Controller 0 might not be the left hand.** WebXR controller index doesn't guarantee handedness. Check `inputSource.handedness` instead.
- **Canvas `roundRect()` might not be supported** on Quest 3 browser. This is a newer API. If it throws, the canvas is blank → transparent texture → invisible. Add try/catch or use manual path drawing.
- **Position (0, 0.07, -0.04)** with rotation -0.5 rad might be pointing away from the user. The controller coordinate system varies between headsets.
- **The HUD render might be working but too small** (0.13 x 0.09m).

**Debug:** Add `console.log` in `_createControlsHUD` to confirm it runs. Try making the HUD larger and at a more visible position temporarily.

### 4. No draggability (grip/squeeze)
`squeezestart`/`squeezeend` events are registered on each controller. Quest 3 controllers DO support these.

**Potential issues:**
- **`_raycastPanel(controllerIndex)` returns null** because the panel mesh is invisible (XRQuadLayer path hides it: `panel.mesh.visible = false`). BUT Three.js Raycaster DOES intersect invisible meshes by default. Wait — does it? **CHECK THIS.** Actually, `Raycaster.intersectObjects` skips objects where `visible === false` unless you pass `recursive` and the parent is visible. **This could be the bug if XRQuadLayer activated.**
- Actually on Quest 3 browser, XRQuadLayer likely DOES NOT activate (XRMediaBinding might not exist). The diagnostic logs should show this. The panel mesh would stay visible.
- **More likely:** The `squeezestart` event fires but `_raycastPanel` misses. The raycaster uses `controller.matrixWorld` — which might not be updated at event time. Try adding a `console.log` for the intersection test in `onSqueezeStart`.

**Existing debug log:** `onSqueezeStart` already has `console.log('[Input] Grip pressed (controller ${controllerIndex})')` and logs "no panel hit" with panel count. **Check Quest browser console for these messages** via chrome://inspect.

### 5. No auto-capture
In `main.js`, auto-capture triggers in `onWindowList` when `this.panelManager.panels.size === 0 && this.streamClient.capturePeerIds.length > 0`.

**Potential issue:** The `window-list` message might arrive before the capture peer registers. In `StreamClient._handleSignal`, `capturePeerIds` is populated from:
1. `welcome` message: `msg.peers.filter(p => p.role === 'capture')` → fills `capturePeerIds`
2. `peer-registered` message: pushes new peerId

The `requestWindowList()` is called after `connect()` resolves (after welcome). So `capturePeerIds` should be populated by then. But the `window-list` response comes from the capture peer asynchronously — by the time it arrives, `capturePeerIds` should have the capture peer.

**More likely issue:** The viewer connects BEFORE the capture app. So at welcome time, no capture peers exist. Then capture app connects, registers, sends window list. The `window-list` handler in `StreamClient` calls `onWindowList`. At that point `capturePeerIds` was populated by `peer-registered` handler. **This should work.**

**Test:** Add `console.log` of `this.streamClient.capturePeerIds` inside the `onWindowList` handler in main.js.

---

## Recommended Fix Order

1. **Distance regression** — Change panel distance from 1.2m to 0.9m (closer = more pixels per degree)
2. **Auto-recenter on VR session start** — Add delayed recenter in `sessionstart` handler
3. **Debug grip** — Check if `Raycaster` skips invisible meshes (it does by default). Force `mesh.visible = true` even for QuadLayer path, use `mesh.material.opacity = 0` instead.
4. **Debug HUD** — Add fallback for `roundRect()`, verify canvas renders
5. **Debug auto-capture** — Add console.log for `capturePeerIds.length` in `onWindowList`

## Key Files to Read
- `c:\Strix Halo VR\prototype\src\main.js` (~256 lines)
- `c:\Strix Halo VR\prototype\src\input\InputManager.js` (~755 lines)
- `c:\Strix Halo VR\prototype\src\scene\PanelManager.js` (~463 lines)
- `c:\Strix Halo VR\prototype\electron\lib\ElectronCaptureClient.js` (~344 lines)
- `c:\Strix Halo VR\prototype\src\scene\WindowPicker.js` (~219 lines)

## NO GIT REPO — Cannot rollback. All fixes must be forward.
