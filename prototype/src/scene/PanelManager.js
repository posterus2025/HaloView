import * as THREE from 'three';

/**
 * Manages virtual desktop panels in the VR scene.
 * Each panel is a quad (plane mesh) that can display:
 * - A demo color + label (placeholder)
 * - A WebRTC video stream (via VideoTexture or XRQuadLayer)
 *
 * When XR Layers are available (Quest 3), video panels use XRQuadLayer
 * for native-resolution compositing (same path as Quest system menus).
 * An invisible proxy mesh is kept for raycasting.
 */
export class PanelManager {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.panels = new Map(); // id -> { mesh, config, stream?, videoTexture?, quadLayer? }
    this.maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;

    // XR Layers state (initialized on XR session start)
    this.xrSession = null;
    this.xrRefSpace = null;
    this.mediaBinding = null;
    this.layersSupported = false;
    this.quadLayers = new Map(); // panelId -> XRQuadLayer

    // Curve radius for spherical-section panels.
    // Every texel is equidistant from the eye -> uniform pixel density -> no edge aliasing.
    // 3.0m gives a subtle, natural curve (1.6m panel subtends ~30 deg). Was 0.9m (too aggressive).
    this.curveRadius = 3.0;

    // Resize constraints
    this.minPanelHeight = 0.3; // meters
    this.maxPanelHeight = 1.8; // meters

    // Gaze-based focus tracking
    this._focusedPanelId = null;
    this._gazeDir = new THREE.Vector3();
  }

  /**
   * Create a geometry curved like a section of a sphere.
   * Every surface point is equidistant from the viewer at `radius`,
   * eliminating the 33% distance gradient that flat panels have at their edges.
   * UVs are preserved from the original plane so video textures map correctly.
   */
  _createCurvedGeometry(width, height, radius) {
    if (radius === undefined) radius = this.curveRadius;
    const wSegs = 48;
    const hSegs = 32;
    const geometry = new THREE.PlaneGeometry(width, height, wSegs, hSegs);
    const pos = geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);

      // Map flat X/Y to angular coordinates (arc length = radius * angle)
      const theta = x / radius; // horizontal angle
      const phi = y / radius;   // vertical angle

      // Project onto sphere whose center is at (0, 0, +radius) in local space.
      // Panel center (x=0, y=0) stays at the origin; edges curve toward the viewer.
      pos.setXYZ(i,
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(phi),
        radius * (1 - Math.cos(theta) * Math.cos(phi))
      );
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Initialize XR Layers support when an XR session starts.
   * Call after renderer.xr.setSession().
   */
  initXRLayers(session, renderer) {
    this.xrSession = session;
    this.xrRefSpace = renderer.xr.getReferenceSpace();

    try {
      const hasXRMediaBinding = typeof XRMediaBinding !== 'undefined';
      const hasLayers = !!session.renderState.layers;
      const layerCount = hasLayers ? session.renderState.layers.length : 0;
      console.log(`[PanelManager] XR Layers check: XRMediaBinding=${hasXRMediaBinding}, renderState.layers=${hasLayers} (${layerCount} layers)`);

      if (hasXRMediaBinding && hasLayers) {
        this.mediaBinding = new XRMediaBinding(session);
        this.layersSupported = true;
        console.log('[PanelManager] XR Layers supported — using XRQuadLayer for video panels');
      } else {
        console.log(`[PanelManager] XR Layers not available — using VideoTexture fallback (XRMediaBinding: ${hasXRMediaBinding}, layers: ${hasLayers})`);
      }
    } catch (e) {
      console.warn('[PanelManager] XR Layers init failed:', e.message);
      this.layersSupported = false;
    }
  }

  /**
   * Clean up XR Layers state when XR session ends.
   */
  cleanupXRLayers() {
    this.quadLayers.clear();
    this.mediaBinding = null;
    this.xrSession = null;
    this.xrRefSpace = null;
    this.layersSupported = false;

    // Restore proxy mesh opacity (fall back to VideoTexture rendering)
    for (const panel of this.panels.values()) {
      if (panel.mesh) {
        panel.mesh.visible = true;
        panel.mesh.material.opacity = 1;
        panel.mesh.material.transparent = false;
      }
      panel.quadLayer = null;
    }

    console.log('[PanelManager] XR Layers cleaned up');
  }

  /**
   * Add a demo panel with a colored background and text label.
   */
  addDemoPanel({ id, position, rotation, width, height, color, label }) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round(1024 * (height / width));
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    // Label
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 48px JetBrains Mono, Cascadia Code, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || id, canvas.width / 2, canvas.height / 2);

    // Panel ID in corner
    ctx.fillStyle = '#666';
    ctx.font = '24px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`[${id}]`, 16, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const geometry = this._createCurvedGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (rotation) {
      mesh.rotation.copy(rotation);
    }
    mesh.userData = { panelId: id, isPanel: true };

    this.scene.add(mesh);

    const panel = { id, mesh, config: { width, height, color, label }, canvas, ctx };
    this.panels.set(id, panel);

    console.log(`[PanelManager] Added demo panel: ${id} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    return panel;
  }

  /**
   * Attach a WebRTC MediaStream to a panel as an XRQuadLayer (native-res compositor).
   * Falls back to attachStream() if layers aren't supported.
   */
  attachStreamAsQuadLayer(panelId, mediaStream) {
    const panel = this.panels.get(panelId);
    if (!panel || !this.layersSupported || !this.mediaBinding || !this.xrRefSpace) {
      console.log(`[PanelManager] QuadLayer path skipped for '${panelId}': panel=${!!panel}, layers=${this.layersSupported}, binding=${!!this.mediaBinding}, refSpace=${!!this.xrRefSpace}`);
      this.attachStream(panelId, mediaStream);
      return;
    }
    console.log(`[PanelManager] Attempting XRQuadLayer path for '${panelId}'`);

    const video = document.createElement('video');
    video.srcObject = mediaStream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.play();

    panel.videoElement = video;

    video.addEventListener('loadedmetadata', () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
          console.warn(`[PanelManager] No video dimensions for '${panelId}', using VideoTexture`);
          this.attachStream(panelId, mediaStream);
          return;
        }

        const aspect = vw / vh;
        const height = panel.config.height;
        const width = height * aspect;

        const quadLayer = this.mediaBinding.createQuadLayer(video, {
          space: this.xrRefSpace,
          width: width,
          height: height,
          layout: 'mono',
          transform: this._meshToXRTransform(panel.mesh),
        });

        this.quadLayers.set(panelId, quadLayer);
        panel.quadLayer = quadLayer;
        panel.config.width = width;

        // Update proxy mesh geometry for raycasting — keep visible but fully transparent
        // (Raycaster.intersectObjects skips meshes with visible=false)
        panel.mesh.geometry.dispose();
        panel.mesh.geometry = new THREE.PlaneGeometry(width, height);
        panel.mesh.material.transparent = true;
        panel.mesh.material.opacity = 0;

        this._updateLayersArray();
        console.log(`[PanelManager] XRQuadLayer created for '${panelId}' (${vw}x${vh}, ${width.toFixed(2)}x${height.toFixed(2)}m)`);
      } catch (e) {
        console.warn(`[PanelManager] XRQuadLayer failed for '${panelId}':`, e.message, '— falling back to VideoTexture');
        this.attachStream(panelId, mediaStream);
      }
    });
  }

  /**
   * Attach a WebRTC MediaStream to a panel, replacing its demo texture.
   * (VideoTexture fallback path — used when XR Layers are not available)
   */
  attachStream(panelId, mediaStream) {
    const panel = this.panels.get(panelId);
    if (!panel) {
      console.warn(`[PanelManager] Panel not found: ${panelId}`);
      return;
    }

    const video = document.createElement('video');
    video.srcObject = mediaStream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.play();

    const videoTexture = new THREE.VideoTexture(video);
    // NO mipmaps for video — mipmap generation on every frame is expensive AND
    // causes blur because the GPU samples lower mip levels at panel edges.
    // Simple bilinear (LinearFilter) is sharper for screen content.
    videoTexture.generateMipmaps = false;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.anisotropy = this.maxAnisotropy;
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    panel.mesh.material.map = videoTexture;
    panel.mesh.material.needsUpdate = true;
    panel.mesh.visible = true;
    panel.videoTexture = videoTexture;
    panel.videoElement = video;

    // Auto-resize panel geometry to match video aspect ratio once metadata loads
    video.addEventListener('loadedmetadata', () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const aspect = vw / vh;
        const height = panel.config.height;
        const width = height * aspect;
        panel.mesh.geometry.dispose();
        panel.mesh.geometry = this._createCurvedGeometry(width, height);
        panel.config.width = width;
        console.log(`[PanelManager] Resized panel '${panelId}' to ${width.toFixed(2)}x${height.toFixed(2)} (video: ${vw}x${vh}, curved r=${this.curveRadius}m)`);
      }
    });

    console.log(`[PanelManager] Attached stream to panel: ${panelId} (no mipmaps, bilinear, curved fallback)`);
  }

  /**
   * Remove a panel from the scene and clean up resources.
   */
  removePanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    this.scene.remove(panel.mesh);
    panel.mesh.geometry.dispose();
    panel.mesh.material.dispose();
    if (panel.videoElement) {
      panel.videoElement.pause();
      panel.videoElement.srcObject = null;
    }
    if (panel.videoTexture) {
      panel.videoTexture.dispose();
    }
    if (panel.quadLayer) {
      this.quadLayers.delete(panelId);
      this._updateLayersArray();
    }
    this.panels.delete(panelId);
    console.log(`[PanelManager] Removed panel: ${panelId}`);
  }

  /**
   * Toggle panel orientation between landscape and portrait.
   * Returns the new orientation string, or null if panel not found.
   */
  toggleOrientation(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return null;

    const { width, height } = panel.config;
    panel.config.width = height;
    panel.config.height = width;

    panel.mesh.geometry.dispose();
    panel.mesh.geometry = this._createCurvedGeometry(height, width);

    if (panel.quadLayer) {
      panel.quadLayer.width = height;
      panel.quadLayer.height = width;
    }

    const orientation = panel.config.width > panel.config.height ? 'landscape' : 'portrait';
    console.log(`[PanelManager] Toggled '${panelId}' to ${orientation} (${panel.config.width.toFixed(2)}x${panel.config.height.toFixed(2)})`);
    return orientation;
  }

  /**
   * Resize a panel to a new height, maintaining aspect ratio.
   * Geometry is rebuilt (not scaled) to maintain curved geometry integrity.
   */
  resizePanel(panelId, newHeight) {
    const panel = this.panels.get(panelId);
    if (!panel) return null;

    newHeight = THREE.MathUtils.clamp(newHeight, this.minPanelHeight, this.maxPanelHeight);

    const currentAspect = panel.config.width / panel.config.height;
    const newWidth = newHeight * currentAspect;

    panel.config.width = newWidth;
    panel.config.height = newHeight;

    panel.mesh.geometry.dispose();
    if (panel.quadLayer) {
      panel.mesh.geometry = new THREE.PlaneGeometry(newWidth, newHeight);
      panel.quadLayer.width = newWidth;
      panel.quadLayer.height = newHeight;
    } else {
      panel.mesh.geometry = this._createCurvedGeometry(newWidth, newHeight);
    }

    panel.mesh.scale.set(1, 1, 1);
    console.log(`[PanelManager] Resized '${panelId}' to ${newWidth.toFixed(2)}x${newHeight.toFixed(2)}m`);
    return { width: newWidth, height: newHeight };
  }

  /**
   * Get the panel mesh at a ray intersection point.
   */
  getPanelAtIntersection(raycaster) {
    const meshes = Array.from(this.panels.values()).map(p => p.mesh);
    const intersections = raycaster.intersectObjects(meshes, false);
    if (intersections.length > 0) {
      const hit = intersections[0];
      const panelId = hit.object.userData.panelId;
      return { panel: this.panels.get(panelId), intersection: hit };
    }
    return null;
  }

  /**
   * Get UV coordinates where a ray hits a panel (for input forwarding).
   */
  getHitUV(intersection) {
    if (!intersection.uv) return null;
    return { u: intersection.uv.x, v: 1.0 - intersection.uv.y }; // Flip V for screen coords
  }

  /**
   * Arrange all panels in a curved (cylindrical) layout around the user.
   * @param {number} radius - Distance from center to panels
   * @param {number} centerHeight - Eye height for panels
   * @param {number} arcDegrees - Total arc span
   * @param {THREE.Vector3} centerPos - User's head position (defaults to origin)
   * @param {THREE.Vector3} facingDir - User's forward direction (defaults to -Z)
   */
  arrangeCurved(radius = 1.4, centerHeight = 1.5, arcDegrees = 60, centerPos = null, facingDir = null) {
    const panelList = Array.from(this.panels.values());
    const n = panelList.length;
    if (n === 0) return;

    const cx = centerPos ? centerPos.x : 0;
    const cz = centerPos ? centerPos.z : 0;
    // Base angle: which world direction is "forward" for the user
    const baseAngle = facingDir ? Math.atan2(facingDir.x, -facingDir.z) : 0;

    const arcRad = (arcDegrees * Math.PI) / 180;
    const startAngle = -arcRad / 2;
    const step = n > 1 ? arcRad / (n - 1) : 0;

    for (let i = 0; i < n; i++) {
      const localAngle = n === 1 ? 0 : startAngle + step * i;
      const worldAngle = baseAngle + localAngle;
      const x = cx + Math.sin(worldAngle) * radius;
      const z = cz - Math.cos(worldAngle) * radius;

      const panel = panelList[i];
      panel.mesh.position.set(x, centerHeight, z);
      // Face panel toward user (plane +Z toward center)
      const dx = cx - x;
      const dz = cz - z;
      panel.mesh.rotation.set(0, Math.atan2(dx, dz), 0);
    }

    console.log(`[PanelManager] Arranged ${n} panels in ${arcDegrees} deg arc at radius ${radius}m (center: ${cx.toFixed(1)}, ${cz.toFixed(1)})`);
  }

  /**
   * Recenter all panels around the user's current head position and direction.
   */
  recenterToHead(headPos, headForward) {
    const panelList = Array.from(this.panels.values());
    if (panelList.length === 0) return;

    const height = headPos.y;
    if (panelList.length === 1) {
      // Single panel: place directly in front
      const fwd = headForward.clone();
      fwd.y = 0;
      fwd.normalize();
      const pos = headPos.clone().add(fwd.multiplyScalar(0.9));
      pos.y = height;
      panelList[0].mesh.position.copy(pos);
      // Face toward user
      const dx = headPos.x - pos.x;
      const dz = headPos.z - pos.z;
      panelList[0].mesh.rotation.set(0, Math.atan2(dx, dz), 0);
    } else {
      this.arrangeCurved(1.4, height, 60, headPos, headForward);
    }

    // Sync quad layer transforms
    for (const [panelId, quadLayer] of this.quadLayers) {
      const panel = this.panels.get(panelId);
      if (panel) {
        try { quadLayer.transform = this._meshToXRTransform(panel.mesh); } catch (e) {}
      }
    }

    console.log(`[PanelManager] Recentered ${panelList.length} panel(s) to head position`);
  }

  /**
   * Arrange panels in a flat grid layout.
   */
  arrangeGrid(cols = 4, startHeight = 1.2, distance = 1.5, gapX = 0.1, gapY = 0.1) {
    const panelList = Array.from(this.panels.values());
    const n = panelList.length;
    if (n === 0) return;

    const rows = Math.ceil(n / cols);

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const panel = panelList[i];
      const w = panel.config.width;
      const h = panel.config.height;

      const totalWidth = cols * w + (cols - 1) * gapX;
      const x = col * (w + gapX) - totalWidth / 2 + w / 2;
      const y = startHeight + (rows - 1 - row) * (h + gapY);

      panel.mesh.position.set(x, y, -distance);
      panel.mesh.rotation.set(0, 0, 0);
    }

    console.log(`[PanelManager] Arranged ${n} panels in ${cols}x${rows} grid`);
  }

  /**
   * Convert a Three.js mesh transform to an XRRigidTransform.
   */
  _meshToXRTransform(mesh) {
    const pos = mesh.position;
    const quat = new THREE.Quaternion();
    mesh.getWorldQuaternion(quat);
    return new XRRigidTransform(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
    );
  }

  /**
   * Update the XR session's layers array (projection layer + all quad layers).
   */
  _updateLayersArray() {
    if (!this.xrSession || !this.layersSupported) return;

    const existingLayers = this.xrSession.renderState.layers;
    if (!existingLayers || existingLayers.length === 0) return;

    // First layer is the projection layer (managed by Three.js)
    const projectionLayer = existingLayers[0];
    const layers = [projectionLayer, ...this.quadLayers.values()];

    this.xrSession.updateRenderState({ layers });
    console.log(`[PanelManager] Updated XR layers: 1 projection + ${this.quadLayers.size} quad`);
  }

  /**
   * Gaze-based focus tracking: identifies which panel the user is looking at.
   * Used for future enhancements (e.g., adaptive bitrate per panel).
   * No longer toggles mipmaps — mipmaps are disabled entirely for video textures.
   */
  _updateFoveatedFocus(headPos, headDir) {
    let bestPanelId = null;
    let bestDot = -1;

    for (const [panelId, panel] of this.panels) {
      if (!panel.videoTexture) continue;
      this._gazeDir.copy(panel.mesh.position).sub(headPos).normalize();
      const dot = this._gazeDir.dot(headDir);
      if (dot > bestDot) {
        bestDot = dot;
        bestPanelId = panelId;
      }
    }

    // Only count as "focused" if within ~30 deg of gaze center (cos 30 ~ 0.87)
    if (bestDot < 0.87) bestPanelId = null;
    this._focusedPanelId = bestPanelId;
  }

  update(time, headPos, headDir) {
    // Gaze-based focus tracking
    if (headPos && headDir) {
      this._updateFoveatedFocus(headPos, headDir);
    }

    // Sync quad layer transforms with mesh positions (handles drag/move)
    for (const [panelId, quadLayer] of this.quadLayers) {
      const panel = this.panels.get(panelId);
      if (panel) {
        try {
          quadLayer.transform = this._meshToXRTransform(panel.mesh);
        } catch (e) {
          // Transform sync can fail if session ended
        }
      }
    }
  }
}
