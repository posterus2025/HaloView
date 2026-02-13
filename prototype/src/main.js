import * as THREE from 'three';
import { VRButton } from './vr/VRButton.js';
import { PanelManager } from './scene/PanelManager.js';
import { InputManager } from './input/InputManager.js';
import { StreamClient } from './streaming/StreamClient.js';
import { WindowPicker } from './scene/WindowPicker.js';

class HaloViewApp {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.panelManager = null;
    this.inputManager = null;
    this.streamClient = null;
    this.windowPicker = null;
    this.controllers = [];
    this._panelSourceIds = new Map(); // panelId -> sourceId (for re-capture on orientation change)
  }

  async init() {
    // Renderer with WebXR support
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    document.body.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera (used in non-VR mode; XR overrides in VR)
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
    this.camera.position.set(0, 1.6, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(ambient);

    // Reference grid (visible in passthrough to orient the user)
    const grid = new THREE.GridHelper(6, 12, 0x444444, 0x222222);
    grid.position.y = 0;
    this.scene.add(grid);

    // Panel manager — panels are created dynamically when streams arrive
    this.panelManager = new PanelManager(this.scene, this.renderer);

    // Window picker — 3D overlay for selecting PC windows from VR
    this.windowPicker = new WindowPicker(this.scene);

    // Input handling
    this.inputManager = new InputManager(this.renderer, this.scene, this.camera, this.panelManager);
    this.inputManager.setupControllers();
    this.inputManager.createExitButton();
    this.inputManager.createAddPanelButton();
    this.inputManager.windowPicker = this.windowPicker;

    // Recenter callback — re-place buttons when user recenters
    this.inputManager.onRecenter = () => {
      console.log('[HaloView] Workspace recentered');
    };

    // Window selection from picker -> request capture from Electron app
    this.inputManager.onWindowSelected = (sourceId, panelId, orientation) => {
      if (this.streamClient.capturePeerIds.length > 0) {
        const captureId = this.streamClient.capturePeerIds[0];
        this.streamClient.requestWindowCapture(captureId, sourceId, panelId, orientation);
        this.windowPicker.hide();
        this._panelSourceIds.set(panelId, sourceId);
        this._updateInfo(`Requesting capture for ${panelId}...`);
        console.log(`[HaloView] Requested capture of window as ${panelId}`);
      } else {
        console.warn('[HaloView] No capture peer connected');
        this._updateInfo('No PC capture app connected');
      }
    };

    // Panel dismissal (grab + throw far)
    this.inputManager.onPanelDismissed = (panelId) => {
      if (this.streamClient.capturePeerIds.length > 0) {
        const captureId = this.streamClient.capturePeerIds[0];
        this.streamClient.releasePanel(captureId, panelId);
      }
      this.panelManager.removePanel(panelId);
      this._panelSourceIds.delete(panelId);
      const headPos = this.inputManager.getHeadPosition();
      const headFwd = this.inputManager.getHeadForward();
      this.panelManager.arrangeCurved(1.4, headPos.y, 60, headPos, headFwd);
      this._updateInfo(`${this.panelManager.panels.size} panel(s) streaming`);
    };

    // Boost framebuffer beyond native (Quest 3 default is ~81% native)
    // 1.5 = ~150% native -> supersampled for text clarity
    this.renderer.xr.setFramebufferScaleFactor(1.5);

    // VR button — request 'layers' for XRQuadLayer support
    const vrButton = VRButton.createButton(this.renderer, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      requiredFeatures: ['local-floor'],
    });
    document.body.appendChild(vrButton);

    // XR session lifecycle for layers
    this.renderer.xr.addEventListener('sessionstart', () => {
      const session = this.renderer.xr.getSession();
      this.panelManager.initXRLayers(session, this.renderer);

      // Delay recenter to let head tracking initialize, then snap panels in front of user
      setTimeout(() => {
        if (this.panelManager.panels.size > 0) {
          this.inputManager._recenter();
          console.log('[HaloView] Auto-recentered panels on VR session start');
        }
      }, 500);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.panelManager.cleanupXRLayers();
    });

    // Handle window resize
    window.addEventListener('resize', () => this.onResize());

    // Render loop
    this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));

    // Connect to signaling server for WebRTC streaming
    this.connectStreaming();

    // Update status overlay
    this._updateInfo('Waiting for PC capture app...');
    console.log('[HaloView] Initialized. Launch the Electron capture app on PC.');
  }

  async connectStreaming() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const signalingUrl = `${proto}://${location.host}/signal`;

    this.streamClient = new StreamClient(signalingUrl);

    // When a video stream arrives, create a panel if it doesn't exist, then attach
    this.streamClient.onStream = (panelId, mediaStream) => {
      console.log(`[HaloView] Stream received for panel '${panelId}'`);

      const isFirstPanel = this.panelManager.panels.size === 0;

      if (!this.panelManager.panels.has(panelId)) {
        // Place panel in front of wherever the user is currently looking
        const headPos = this.inputManager.getHeadPosition();
        const panelPos = this.inputManager.getInFrontOfHead(0.9);
        // Face the panel toward the user
        const dx = headPos.x - panelPos.x;
        const dz = headPos.z - panelPos.z;
        const panelRotY = Math.atan2(dx, dz);

        this.panelManager.addDemoPanel({
          id: panelId,
          position: panelPos,
          rotation: new THREE.Euler(0, panelRotY, 0),
          width: 1.6,
          height: 0.9,
          color: 0x1a1a2e,
          label: panelId,
        });

        // If multiple panels, arrange in a curve around user's CURRENT forward
        if (this.panelManager.panels.size > 1) {
          const headFwd = this.inputManager.getHeadForward();
          this.panelManager.arrangeCurved(1.4, headPos.y, 60, headPos, headFwd);
        }

        // Always recenter after adding a panel so everything is in front of user
        this.inputManager._recenter();

        // Position buttons relative to user after first panel arrives
        if (isFirstPanel) {
          this.inputManager.repositionButtons();
        }

        console.log(`[HaloView] Created panel '${panelId}' at (${panelPos.x.toFixed(2)}, ${panelPos.y.toFixed(2)}, ${panelPos.z.toFixed(2)}) (${this.panelManager.panels.size} total)`);
      }

      // Prefer XRQuadLayer (native compositor path — same as Quest system menus).
      // Falls back to VideoTexture if layers aren't supported.
      // Flat quad + compositor > curved mesh through WebGL framebuffer for sharpness.
      if (this.panelManager.layersSupported) {
        console.log(`[HaloView] Attaching stream via XRQuadLayer for '${panelId}' (native compositor)`);
        this.panelManager.attachStreamAsQuadLayer(panelId, mediaStream);
      } else {
        console.log(`[HaloView] Attaching stream via VideoTexture for '${panelId}' (fallback)`);
        this.panelManager.attachStream(panelId, mediaStream);
      }
      this._updateInfo(`${this.panelManager.panels.size} panel(s) streaming`);
    };

    // Wire input forwarding per-panel data channels to InputManager
    this.streamClient.onInputChannel = (panelId, channel) => {
      this.inputManager.setInputChannel(panelId, channel);
      console.log(`[HaloView] Input channel wired for panel '${panelId}'`);
    };

    // Window list from Electron capture app
    this.streamClient.onWindowList = (windows) => {
      console.log(`[HaloView] Window list: ${windows.length} windows, capturePeers: ${this.streamClient.capturePeerIds.length}, panels: ${this.panelManager.panels.size}`);
      this.windowPicker.updateWindowList(windows);

      // Auto-capture primary display on first connect (no picker needed)
      if (this.panelManager.panels.size === 0 && this.streamClient.capturePeerIds.length > 0) {
        const primaryScreen = windows.find(w => w.sourceId.startsWith('screen:'));
        if (primaryScreen) {
          const captureId = this.streamClient.capturePeerIds[0];
          const panelId = 'panel-main';
          this.streamClient.requestWindowCapture(captureId, primaryScreen.sourceId, panelId, 'landscape');
          this._panelSourceIds.set(panelId, primaryScreen.sourceId);
          this.windowPicker._nextPanelId = 2;
          this._updateInfo('Streaming primary display...');
          console.log(`[HaloView] Auto-capturing primary display: ${primaryScreen.name}`);
        } else {
          // No screens found, show picker as fallback
          this.windowPicker.show();
          this._updateInfo(`${windows.length} windows available. Press A/X to pick.`);
        }
      } else {
        this._updateInfo(`${this.panelManager.panels.size} panel(s). Press A/X to add more.`);
      }
    };

    // When a capture peer connects after us, request the window list for auto-capture
    this.streamClient.onCapturePeerConnected = (peerId) => {
      console.log(`[HaloView] Capture peer ${peerId} connected — requesting window list`);
      this._updateInfo('PC capture app connected. Loading windows...');
      this.streamClient.requestWindowList();
    };

    try {
      await this.streamClient.connect();
      console.log('[HaloView] Connected to signaling server');
      this._updateInfo('Connected. Waiting for window list...');
      this.streamClient.requestWindowList();
    } catch (err) {
      console.warn('[HaloView] Signaling server not available:', err.message);
      this._updateInfo('Signaling offline. Start servers on PC.');
    }
  }

  _updateInfo(text) {
    const el = document.querySelector('#info .dim');
    if (el) el.textContent = text;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(time, frame) {
    this.inputManager.update(time, frame);
    // Pass head position + direction for gaze-based focus tracking
    const headPos = this.inputManager.getHeadPosition();
    const headDir = this.inputManager._headDir;
    this.panelManager.update(time, headPos, headDir);
    this.renderer.render(this.scene, this.camera);
  }
}

const app = new HaloViewApp();
app.init().then(() => {
  window.__haloview = app;
}).catch(console.error);
