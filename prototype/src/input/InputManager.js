import * as THREE from 'three';

/**
 * Handles VR controller input for panel interaction.
 * - Laser pointer ray from each controller
 * - Trigger to click/select (forwarded to PC via per-panel data channel)
 * - Grip to grab and move panels (squeeze button)
 * - Thumbstick Y: scroll (pointing) / push-pull distance (grabbing)
 * - Thumbstick X: rotate (grabbing)
 * - A/X button: toggle window picker
 * - B/Y button: recenter workspace (hold 1.5s = exit VR)
 * - Double-tap trigger on panel: toggle orientation
 */
export class InputManager {
  constructor(renderer, scene, camera, panelManager) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.panelManager = panelManager;

    this.controllers = [];
    this.raycasters = [];
    this.tempMatrix = new THREE.Matrix4();

    // Head tracking (updated each frame)
    this._headPos = new THREE.Vector3(0, 1.6, 0);
    this._headDir = new THREE.Vector3(0, 0, -1);

    // Grab state
    this.grabbedPanel = null;
    this.grabOffset = new THREE.Vector3();
    this.grabControllerIndex = -1;

    // Per-panel data channels for input forwarding to PC
    this.inputChannels = new Map(); // panelId -> RTCDataChannel

    // Mouse tracking state
    this._activeClickPanel = null;
    this._lastClickTime = new Map(); // panelId -> timestamp for double-tap
    this._lastMouseSendTime = 0;
    this._mouseThrottleMs = 33; // ~30Hz

    // Snap grid settings
    this.snapEnabled = true;
    this.snapGridSize = 0.1; // 10cm grid

    // UI buttons (3D meshes in scene)
    this.exitButton = null;
    this._addPanelButton = null;

    // Interaction mode: 'move' = manipulate panels, 'interact' = send input to PC
    this._interactionMode = 'move';

    // A/X long-press detection
    this._axPressStart = [0, 0];
    this._axWasPressed = [false, false];
    this._axLongPressMs = 500; // 500ms = mode toggle, shorter = picker toggle

    // Resize state (while grabbing)
    this._pendingResizeHeight = null;
    this._lastResizeRebuildTime = 0;
    this._resizeThrottleMs = 200;

    // Button polling state
    this._byPressStart = [0, 0]; // B/Y press timestamps for long-press detection
    this._byWasPressed = [false, false];
    this._byLongPressMs = 1500; // Hold 1.5s to exit VR

    // Window picker (set externally)
    this.windowPicker = null;
    this.onWindowSelected = null; // callback(sourceId, panelId, orientation)
    this.onPanelDismissed = null; // callback(panelId)
    this.onOrientationToggled = null; // callback(panelId, orientation)
    this.onRecenter = null; // callback()

    // Hover highlight state
    this._hoveredMesh = null;
    this._hoveredOriginalScale = new THREE.Vector3(1, 1, 1);
    this._hoveredOriginalColor = null;

    // Controls HUD (attached to left controller)
    this._controlsHUD = null;
    this._hudCanvas = null;
    this._hudCtx = null;
    this._hudTexture = null;
  }

  // ── Head tracking helpers ──────────────────────────────────────────

  /** Get the user's current head position (world space). */
  getHeadPosition() { return this._headPos.clone(); }

  /** Get the user's horizontal forward direction (Y=0, normalized). */
  getHeadForward() {
    const fwd = this._headDir.clone();
    fwd.y = 0;
    fwd.normalize();
    return fwd;
  }

  /** Get a point `distance` meters in front of the user's head (at eye height). */
  getInFrontOfHead(distance = 0.9) {
    const fwd = this.getHeadForward();
    const pos = this._headPos.clone().add(fwd.multiplyScalar(distance));
    pos.y = this._headPos.y;
    return pos;
  }

  // ── Data channels ──────────────────────────────────────────────────

  setInputChannel(panelId, channel) {
    this.inputChannels.set(panelId, channel);
    console.log(`[Input] Data channel set for panel '${panelId}'`);
    channel.addEventListener('close', () => {
      this.inputChannels.delete(panelId);
      console.log(`[Input] Data channel closed for panel '${panelId}'`);
    });
  }

  // ── UI creation ────────────────────────────────────────────────────

  createExitButton() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#cc3333';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 256, 64, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT VR', 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.20, 0.05);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this.exitButton = new THREE.Mesh(geometry, material);
    this.exitButton.name = '__exitButton';
    this.scene.add(this.exitButton);
  }

  createAddPanelButton() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a2a44';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 256, 64, 10);
    ctx.fill();
    ctx.strokeStyle = '#5599ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 256, 64, 10);
    ctx.stroke();
    ctx.fillStyle = '#5599ff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+ ADD WINDOW', 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.20, 0.05);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this._addPanelButton = new THREE.Mesh(geometry, material);
    this._addPanelButton.name = '__addPanelButton';
    this.scene.add(this._addPanelButton);
  }

  /**
   * Draw a rounded rectangle (polyfill for browsers without CanvasRenderingContext2D.roundRect).
   */
  _roundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }

  /**
   * Create a controls reference HUD attached to the left controller.
   */
  _createControlsHUD(parentController) {
    this._hudCanvas = document.createElement('canvas');
    this._hudCanvas.width = 280;
    this._hudCanvas.height = 200;
    this._hudCtx = this._hudCanvas.getContext('2d');

    this._hudTexture = new THREE.CanvasTexture(this._hudCanvas);
    const geom = new THREE.PlaneGeometry(0.18, 0.13);
    const mat = new THREE.MeshBasicMaterial({
      map: this._hudTexture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this._controlsHUD = new THREE.Mesh(geom, mat);
    this._controlsHUD.position.set(0, 0.08, 0.02);
    this._controlsHUD.rotation.set(-1.0, 0, 0);
    this._controlsHUD.renderOrder = 999;
    parentController.add(this._controlsHUD);

    this._renderControlsHUD();
    console.log('[Input] Controls HUD created and attached to controller');
  }

  _renderControlsHUD() {
    const ctx = this._hudCtx;
    const canvas = this._hudCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = 'rgba(16, 16, 40, 0.92)';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 280, 200, 8);
    ctx.fill();
    ctx.strokeStyle = '#334488';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 280, 200, 8);
    ctx.stroke();

    // Title with mode badge
    const isMove = this._interactionMode === 'move';
    ctx.fillStyle = isMove ? '#5599ff' : '#ff8844';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('HaloView', 12, 24);

    // Mode badge
    const modeText = isMove ? 'MOVE' : 'INTERACT';
    const badgeColor = isMove ? '#2244aa' : '#aa4422';
    const textColor = isMove ? '#88bbff' : '#ffaa77';
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    this._roundRect(ctx, 160, 8, 108, 22, 4);
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(modeText, 214, 23);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = '#334488';
    ctx.beginPath();
    ctx.moveTo(12, 34);
    ctx.lineTo(268, 34);
    ctx.stroke();

    // Control lines — change based on mode
    const controls = isMove
      ? [
          ['Trigger', '(no action)'],
          ['Grip', 'Grab & Move'],
          ['Stick \u2195', 'Resize (grab)'],
          ['Stick \u2194', 'Distance (grab)'],
          ['A / X', 'Add Window'],
          ['Hold A/X', 'Switch Mode'],
          ['B / Y', 'Recenter View'],
        ]
      : [
          ['Trigger', 'Click Panel'],
          ['Grip', 'Grab & Move'],
          ['Stick \u2195', 'Scroll / Resize'],
          ['Stick \u2194', 'Distance (grab)'],
          ['A / X', 'Add Window'],
          ['Hold A/X', 'Switch Mode'],
          ['B / Y', 'Recenter View'],
        ];

    ctx.font = '12px monospace';
    controls.forEach(([key, desc], i) => {
      const y = 54 + i * 22;
      ctx.fillStyle = isMove ? '#77aaff' : '#ffaa77';
      ctx.fillText(key, 12, y);
      ctx.fillStyle = '#999';
      ctx.fillText(desc, 105, y);
    });

    this._hudTexture.needsUpdate = true;
  }

  _updateControlsHUD() {
    if (!this._hudCtx) return;
    this._renderControlsHUD();
  }

  // ── Controller setup ───────────────────────────────────────────────

  setupControllers() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);

      // Laser pointer line
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3),
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.6,
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      controller.add(line);

      // Small sphere at controller tip
      const tipGeometry = new THREE.SphereGeometry(0.005, 8, 8);
      const tipMaterial = new THREE.MeshBasicMaterial({ color: 0x4488ff });
      const tip = new THREE.Mesh(tipGeometry, tipMaterial);
      controller.add(tip);

      // Events
      controller.addEventListener('selectstart', () => this.onSelectStart(i));
      controller.addEventListener('selectend', () => this.onSelectEnd(i));
      controller.addEventListener('squeezestart', () => this.onSqueezeStart(i));
      controller.addEventListener('squeezeend', () => this.onSqueezeEnd(i));

      this.scene.add(controller);
      this.controllers.push({ controller, line, tip });
      this.raycasters.push(new THREE.Raycaster());
    }

    // Attach controls HUD to left controller (index 0)
    if (this.controllers.length > 0) {
      this._createControlsHUD(this.controllers[0].controller);
    }
  }

  // ── Trigger (select) ───────────────────────────────────────────────

  onSelectStart(controllerIndex) {
    const { controller } = this.controllers[controllerIndex];
    controller.updateMatrixWorld(true);
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    const raycaster = this.raycasters[controllerIndex];
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    // Check exit button
    if (this.exitButton) {
      const hits = raycaster.intersectObject(this.exitButton);
      if (hits.length > 0) { this._exitVR(); return; }
    }

    // Check "+" add panel button
    if (this._addPanelButton) {
      const hits = raycaster.intersectObject(this._addPanelButton);
      if (hits.length > 0) {
        this.windowPicker?.toggle();
        return;
      }
    }

    // Check window picker cards
    if (this.windowPicker?.isVisible) {
      const pickerHit = this.windowPicker.getCardAtIntersection(raycaster);
      if (pickerHit) {
        if (pickerHit.action === 'close-picker') {
          this.windowPicker.hide();
        } else if (pickerHit.sourceId && this.onWindowSelected) {
          const panelId = this.windowPicker.getNextPanelId();
          this.onWindowSelected(pickerHit.sourceId, panelId, 'landscape');
          const origColor = pickerHit.mesh.material.color.getHex();
          pickerHit.mesh.material.color.setHex(0x44ff88);
          setTimeout(() => pickerHit.mesh.material.color.setHex(origColor), 200);
          console.log(`[Input] Selected window '${pickerHit.name}' as ${panelId}`);
        }
        return;
      }
    }

    // Check panels — only forward mouse events in Interact mode
    if (this._interactionMode === 'interact') {
      const hit = this._raycastPanel(controllerIndex);
      if (hit) {
        const uv = this.panelManager.getHitUV(hit.intersection);

        this._activeClickPanel = hit.panel.id;
        const channel = this.inputChannels.get(hit.panel.id);
        if (channel?.readyState === 'open') {
          channel.send(JSON.stringify({
            type: 'mousedown',
            panelId: hit.panel.id,
            u: uv?.u,
            v: uv?.v,
            button: 0,
          }));
        }

        this._flashPanel(hit.panel, 0xff8844); // orange flash in interact mode
      }
    }
  }

  onSelectEnd(controllerIndex) {
    if (this._interactionMode === 'interact' && this._activeClickPanel) {
      const channel = this.inputChannels.get(this._activeClickPanel);
      if (channel?.readyState === 'open') {
        channel.send(JSON.stringify({
          type: 'mouseup',
          panelId: this._activeClickPanel,
          button: 0,
        }));
      }
      this._activeClickPanel = null;
    }
  }

  // ── Grip (squeeze) — grab panel ────────────────────────────────────

  onSqueezeStart(controllerIndex) {
    console.log(`[Input] Grip pressed (controller ${controllerIndex})`);
    const hit = this._raycastPanel(controllerIndex);
    if (hit) {
      this.grabbedPanel = hit.panel;
      this.grabControllerIndex = controllerIndex;

      const controller = this.controllers[controllerIndex].controller;
      const controllerWorldPos = new THREE.Vector3();
      controller.getWorldPosition(controllerWorldPos);
      this.grabOffset.copy(hit.panel.mesh.position).sub(controllerWorldPos);

      console.log(`[Input] Grabbed panel '${hit.panel.id}'`);
      this._highlightPanel(hit.panel, true);
    } else {
      console.log(`[Input] Grip pressed but no panel hit (panels: ${this.panelManager.panels.size})`);
    }
  }

  onSqueezeEnd(controllerIndex) {
    if (this.grabbedPanel && this.grabControllerIndex === controllerIndex) {
      // Finalize any pending resize
      if (this._pendingResizeHeight !== null) {
        this.panelManager.resizePanel(this.grabbedPanel.id, this._pendingResizeHeight);
        this._pendingResizeHeight = null;
      }
      if (this.snapEnabled) {
        this._snapToGrid(this.grabbedPanel.mesh);
      }
      console.log(`[Input] Released panel '${this.grabbedPanel.id}' at (${
        this.grabbedPanel.mesh.position.x.toFixed(2)}, ${
        this.grabbedPanel.mesh.position.y.toFixed(2)}, ${
        this.grabbedPanel.mesh.position.z.toFixed(2)})`);
      this._highlightPanel(this.grabbedPanel, false);
      this.grabbedPanel = null;
      this.grabControllerIndex = -1;
    }
  }

  // ── Main update loop ───────────────────────────────────────────────

  update(time, frame) {
    // Track head position each frame
    if (this.renderer.xr.isPresenting) {
      const xrCam = this.renderer.xr.getCamera();
      xrCam.getWorldPosition(this._headPos);
      xrCam.getWorldDirection(this._headDir);
    } else {
      this.camera.getWorldPosition(this._headPos);
      this.camera.getWorldDirection(this._headDir);
    }

    // Poll face buttons
    this._checkBYButton();
    this._checkPickerToggle();

    // Update grabbed panel position to follow controller
    if (this.grabbedPanel && this.grabControllerIndex >= 0) {
      const controller = this.controllers[this.grabControllerIndex].controller;
      const controllerWorldPos = new THREE.Vector3();
      controller.getWorldPosition(controllerWorldPos);
      this.grabbedPanel.mesh.position.copy(controllerWorldPos).add(this.grabOffset);
    }

    // Thumbstick input
    this._processThumbstick();

    // Update laser pointer visuals, hover highlight, and send mouse position
    const now = Date.now();
    const sendMouse = now - this._lastMouseSendTime > this._mouseThrottleMs;
    let newHoveredMesh = null;

    for (let i = 0; i < this.controllers.length; i++) {
      const { controller, line } = this.controllers[i];
      controller.updateMatrixWorld(true);
      this.tempMatrix.identity().extractRotation(controller.matrixWorld);
      const raycaster = this.raycasters[i];
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

      let hitDist = Infinity;
      let hitSomething = false;

      // Check UI buttons
      const uiTargets = [];
      if (this.exitButton) uiTargets.push(this.exitButton);
      if (this._addPanelButton) uiTargets.push(this._addPanelButton);
      if (uiTargets.length > 0) {
        const uiHits = raycaster.intersectObjects(uiTargets, false);
        if (uiHits.length > 0 && uiHits[0].distance < hitDist) {
          hitDist = uiHits[0].distance;
          newHoveredMesh = uiHits[0].object;
          hitSomething = true;
        }
      }

      // Check window picker cards
      if (this.windowPicker?.isVisible) {
        const pickerHit = this.windowPicker.getCardAtIntersection(raycaster);
        if (pickerHit?.mesh) {
          const pickerHits = raycaster.intersectObject(pickerHit.mesh, false);
          if (pickerHits.length > 0 && pickerHits[0].distance < hitDist) {
            hitDist = pickerHits[0].distance;
            newHoveredMesh = pickerHit.mesh;
            hitSomething = true;
          }
        }
      }

      // Check panels
      const panelHit = this.panelManager.getPanelAtIntersection(raycaster);
      if (panelHit && panelHit.intersection.distance < hitDist) {
        hitDist = panelHit.intersection.distance;
        newHoveredMesh = panelHit.panel.mesh;
        hitSomething = true;

        // Send continuous mouse position (throttled, not while grabbing)
        if (sendMouse && !this.grabbedPanel && this._interactionMode === 'interact') {
          const uv = this.panelManager.getHitUV(panelHit.intersection);
          if (uv) {
            const channel = this.inputChannels.get(panelHit.panel.id);
            if (channel?.readyState === 'open') {
              channel.send(JSON.stringify({
                type: 'mousemove',
                panelId: panelHit.panel.id,
                u: uv.u,
                v: uv.v,
              }));
            }
          }
        }
      }

      // Update laser pointer visual
      if (hitSomething) {
        line.material.color.setHex(0x44ff88);
        line.material.opacity = 0.8;
        const positions = line.geometry.attributes.position;
        positions.setZ(1, -hitDist);
        positions.needsUpdate = true;
      } else {
        const baseColor = this._interactionMode === 'move' ? 0x4488ff : 0xff8844;
        line.material.color.setHex(baseColor);
        line.material.opacity = 0.4;
        const positions = line.geometry.attributes.position;
        positions.setZ(1, -3);
        positions.needsUpdate = true;
      }

      if (newHoveredMesh) break;
    }

    this._updateHover(newHoveredMesh);
    if (sendMouse) this._lastMouseSendTime = now;
  }

  // ── Hover highlight ────────────────────────────────────────────────

  _updateHover(newMesh) {
    // Skip hover scaling for grabbed panel (conflicts with resize preview)
    if (newMesh && this.grabbedPanel && newMesh === this.grabbedPanel.mesh) {
      newMesh = null;
    }
    if (newMesh === this._hoveredMesh) return;

    if (this._hoveredMesh) {
      this._hoveredMesh.scale.copy(this._hoveredOriginalScale);
      if (this._hoveredOriginalColor !== null) {
        this._hoveredMesh.material.color.setHex(this._hoveredOriginalColor);
      }
    }

    if (newMesh) {
      this._hoveredOriginalScale.copy(newMesh.scale);
      this._hoveredOriginalColor = newMesh.material.color.getHex();
      newMesh.scale.copy(this._hoveredOriginalScale).multiplyScalar(1.04);
      newMesh.material.color.offsetHSL(0, 0, 0.15);
    } else {
      this._hoveredOriginalColor = null;
    }

    this._hoveredMesh = newMesh;
  }

  // ── Thumbstick ─────────────────────────────────────────────────────

  _processThumbstick() {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const sources = session.inputSources;
    if (!sources) return;

    // When grabbing: resize (Y) and push/pull distance (X)
    if (this.grabbedPanel && this.grabControllerIndex >= 0) {
      if (this.grabControllerIndex >= sources.length) return;
      const source = sources[this.grabControllerIndex];
      if (!source?.gamepad) return;

      const axes = source.gamepad.axes;
      const thumbX = axes.length > 2 ? axes[2] : 0;
      const thumbY = axes.length > 3 ? axes[3] : 0;
      const deadzone = 0.15;

      // Y axis: resize panel (aspect-locked)
      if (Math.abs(thumbY) > deadzone) {
        const currentHeight = this.grabbedPanel.config.height;
        const delta = thumbY * -0.008; // up = grow
        const newHeight = THREE.MathUtils.clamp(
          currentHeight + delta,
          this.panelManager.minPanelHeight,
          this.panelManager.maxPanelHeight
        );

        // Instant visual preview via mesh.scale (cheap, every frame)
        const scaleFactor = newHeight / this.grabbedPanel.config.height;
        this.grabbedPanel.mesh.scale.set(scaleFactor, scaleFactor, 1);
        this._pendingResizeHeight = newHeight;

        // Throttled geometry rebuild (expensive, every 200ms)
        const now = Date.now();
        if (now - this._lastResizeRebuildTime > this._resizeThrottleMs) {
          this.panelManager.resizePanel(this.grabbedPanel.id, newHeight);
          this._pendingResizeHeight = null;
          this._lastResizeRebuildTime = now;
        }
      }

      // X axis: push/pull distance from controller
      if (Math.abs(thumbX) > deadzone) {
        const dir = this.grabOffset.clone().normalize();
        const currentDist = this.grabOffset.length();
        const newDist = THREE.MathUtils.clamp(
          currentDist + thumbX * 0.015,
          0.3, 4.0
        );
        this.grabOffset.copy(dir.multiplyScalar(newDist));
      }
      return;
    }

    // When not grabbing: scroll panel being pointed at (interact mode only)
    if (this._interactionMode === 'interact') {
      for (let i = 0; i < Math.min(sources.length, 2); i++) {
        const source = sources[i];
        if (!source?.gamepad) continue;
        const axes = source.gamepad.axes;
        const thumbY = axes.length > 3 ? axes[3] : 0;

        if (Math.abs(thumbY) > 0.2) {
          const hit = this._raycastPanel(i);
          if (hit) {
            const channel = this.inputChannels.get(hit.panel.id);
            if (channel?.readyState === 'open') {
              channel.send(JSON.stringify({
                type: 'scroll',
                panelId: hit.panel.id,
                deltaY: Math.round(thumbY * 3),
              }));
            }
          }
        }
      }
    }
  }

  // ── Button polling ─────────────────────────────────────────────────

  /**
   * B/Y button (index 5): press = recenter, hold 1.5s = exit VR.
   */
  _checkBYButton() {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const sources = session.inputSources;
    if (!sources) return;

    for (let i = 0; i < Math.min(sources.length, 2); i++) {
      const gp = sources[i]?.gamepad;
      if (!gp || gp.buttons.length <= 5) continue;

      const pressed = gp.buttons[5].pressed;
      const now = Date.now();

      if (pressed && !this._byWasPressed[i]) {
        // Button just pressed — record start time
        this._byPressStart[i] = now;
      }

      if (pressed && this._byWasPressed[i]) {
        // Button held — check for long press
        if (now - this._byPressStart[i] > this._byLongPressMs) {
          this._exitVR();
          this._byPressStart[i] = Infinity; // Prevent re-triggering
          return;
        }
      }

      if (!pressed && this._byWasPressed[i]) {
        // Button just released — short press = recenter
        if (now - this._byPressStart[i] < this._byLongPressMs) {
          this._recenter();
        }
      }

      this._byWasPressed[i] = pressed;
    }
  }

  /**
   * A/X button (index 4): toggle window picker.
   */
  /**
   * A/X button (index 4):
   *   Short press (<500ms) = toggle window picker
   *   Long press (>=500ms) = toggle interaction mode (move / interact)
   */
  _checkPickerToggle() {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const sources = session.inputSources;
    if (!sources) return;

    for (let i = 0; i < Math.min(sources.length, 2); i++) {
      const gp = sources[i]?.gamepad;
      if (!gp || gp.buttons.length <= 4) continue;

      const pressed = gp.buttons[4].pressed;
      const now = Date.now();

      if (pressed && !this._axWasPressed[i]) {
        // Button just pressed
        this._axPressStart[i] = now;
      }

      if (pressed && this._axWasPressed[i]) {
        // Button held — check for long press
        if (now - this._axPressStart[i] >= this._axLongPressMs) {
          this._toggleInteractionMode();
          this._axPressStart[i] = Infinity; // prevent re-trigger while held
        }
      }

      if (!pressed && this._axWasPressed[i]) {
        // Button released
        if (now - this._axPressStart[i] < this._axLongPressMs) {
          // Short press = toggle window picker
          if (this.windowPicker) {
            this.windowPicker.toggle();
            if (this.windowPicker.isVisible) {
              this.windowPicker.group.position.copy(this._headPos);
              this.windowPicker.group.position.y = 0;
            }
          }
        }
      }

      this._axWasPressed[i] = pressed;
    }
  }

  _toggleInteractionMode() {
    this._interactionMode = this._interactionMode === 'move' ? 'interact' : 'move';
    console.log(`[Input] Mode switched to: ${this._interactionMode.toUpperCase()}`);

    const color = this._interactionMode === 'move' ? 0x4488ff : 0xff8844;
    for (const { line } of this.controllers) {
      line.material.color.setHex(color);
    }

    this._updateControlsHUD();
  }

  // ── Recenter ───────────────────────────────────────────────────────

  _recenter() {
    console.log('[Input] Recentering workspace');

    // Reposition panels around current head position
    this.panelManager.recenterToHead(this._headPos, this.getHeadForward());

    // Reposition floating buttons below the panels
    this._repositionButtons();

    // Fire external callback
    if (this.onRecenter) this.onRecenter();
  }

  /**
   * Position the exit/add buttons below the panels, facing the user.
   */
  repositionButtons() {
    this._repositionButtons();
  }

  _repositionButtons() {
    const fwd = this.getHeadForward();
    const buttonCenter = this._headPos.clone().add(fwd.clone().multiplyScalar(0.9));
    const buttonY = this._headPos.y - 0.55;

    // Compute the right vector (perpendicular to forward, in XZ plane)
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    if (this.exitButton) {
      const pos = buttonCenter.clone().add(right.clone().multiplyScalar(-0.12));
      pos.y = buttonY;
      this.exitButton.position.copy(pos);
      // Face button toward user
      const dx = this._headPos.x - pos.x;
      const dz = this._headPos.z - pos.z;
      this.exitButton.rotation.set(0, Math.atan2(dx, dz), 0);
    }

    if (this._addPanelButton) {
      const pos = buttonCenter.clone().add(right.clone().multiplyScalar(0.12));
      pos.y = buttonY;
      this._addPanelButton.position.copy(pos);
      const dx = this._headPos.x - pos.x;
      const dz = this._headPos.z - pos.z;
      this._addPanelButton.rotation.set(0, Math.atan2(dx, dz), 0);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  _snapToGrid(mesh) {
    const g = this.snapGridSize;
    mesh.position.x = Math.round(mesh.position.x / g) * g;
    mesh.position.y = Math.round(mesh.position.y / g) * g;
    mesh.position.z = Math.round(mesh.position.z / g) * g;
  }

  _raycastPanel(controllerIndex) {
    const { controller } = this.controllers[controllerIndex];
    // Force matrix update — events fire before renderer.render() calls scene.updateMatrixWorld()
    controller.updateMatrixWorld(true);
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);

    const raycaster = this.raycasters[controllerIndex];
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    return this.panelManager.getPanelAtIntersection(raycaster);
  }

  _flashPanel(panel, color) {
    const originalColor = panel.mesh.material.color.getHex();
    panel.mesh.material.color.setHex(color);
    setTimeout(() => panel.mesh.material.color.setHex(originalColor), 150);
  }

  _highlightPanel(panel, active) {
    if (active) {
      panel.mesh.material.opacity = 0.85;
      panel.mesh.material.transparent = true;
    } else {
      panel.mesh.material.opacity = 1.0;
      panel.mesh.material.transparent = false;
    }
  }

  _exitVR() {
    const session = this.renderer.xr.getSession();
    if (session) {
      console.log('[Input] Exiting VR session');
      session.end();
    }
  }
}
