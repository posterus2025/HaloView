import * as THREE from 'three';

/**
 * 3D window picker overlay for the VR scene.
 * Shows thumbnails of open PC windows; user points and clicks to start streaming.
 */
export class WindowPicker {
  constructor(scene) {
    this.scene = scene;
    // Polyfill helper for roundRect (not supported on all Quest 3 browser versions)
    this._roundRect = (ctx, x, y, w, h, r) => {
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
    };
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.windowCards = new Map(); // sourceId -> { mesh, data }
    this.onWindowSelected = null; // callback(sourceId, panelId, orientation)
    this._nextPanelId = 1;
    this._closeButton = null;
    this._titleMesh = null;
  }

  show() { this.group.visible = true; }
  hide() { this.group.visible = false; }
  toggle() { this.group.visible = !this.group.visible; }
  get isVisible() { return this.group.visible; }

  getNextPanelId() {
    return `panel-${this._nextPanelId++}`;
  }

  /**
   * Update the picker with a new window list from the capture peer.
   */
  updateWindowList(windows) {
    // Clear existing
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.windowCards.clear();

    const cardWidth = 0.30;
    const cardHeight = 0.22;
    const cols = Math.min(windows.length, 3);
    const radius = 0.8;
    const centerHeight = 1.5;

    windows.forEach((win, i) => {
      const card = this._createWindowCard(win, cardWidth, cardHeight);
      this.windowCards.set(win.sourceId, { mesh: card, data: win });
      this.group.add(card);
    });

    this._arrangeCurved(cols, radius, centerHeight, cardHeight);
    this._addTitle(centerHeight, radius, windows.length);
    this._addCloseButton(centerHeight, radius);
  }

  _createWindowCard(windowData, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 288;
    const ctx = canvas.getContext('2d');

    // Card background
    ctx.fillStyle = '#1e1e32';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
    ctx.stroke();

    // Placeholder background for thumbnail area
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(12, 12, 360, 202);

    // Window name label
    ctx.fillStyle = '#cccccc';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = windowData.name.length > 30
      ? windowData.name.substring(0, 27) + '...'
      : windowData.name;
    ctx.fillText(name, canvas.width / 2, 244);

    // "Click to add" hint
    ctx.fillStyle = '#5599ff';
    ctx.font = '12px sans-serif';
    ctx.fillText('click to stream', canvas.width / 2, 268);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Load thumbnail async
    if (windowData.thumbnail) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 12, 12, 360, 202);
        texture.needsUpdate = true;
      };
      img.src = windowData.thumbnail;
    }

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { isWindowCard: true, sourceId: windowData.sourceId, windowName: windowData.name };
    return mesh;
  }

  _arrangeCurved(cols, radius, centerHeight, cardHeight) {
    const cards = Array.from(this.windowCards.values()).map(c => c.mesh);
    const n = cards.length;
    if (n === 0) return;

    const rows = Math.ceil(n / cols);
    const arcDeg = Math.min(70, cols * 22);
    const arcRad = (arcDeg * Math.PI) / 180;

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const colCount = Math.min(cols, n - row * cols);
      const colArc = colCount > 1 ? arcRad : 0;
      const colStart = -colArc / 2;
      const angle = colStart + (colCount > 1 ? (colArc / (colCount - 1)) * col : 0);

      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius;
      const y = centerHeight + ((rows - 1) / 2 - row) * (cardHeight + 0.04);

      cards[i].position.set(x, y, z);
      cards[i].rotation.set(0, -angle, 0);
    }
  }

  _addTitle(centerHeight, radius, count) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#5599ff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Select a Window (${count} available)`, 256, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.6, 0.05);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this._titleMesh = new THREE.Mesh(geometry, material);

    const cards = Array.from(this.windowCards.values()).map(c => c.mesh);
    const topY = cards.length > 0
      ? Math.max(...cards.map(c => c.position.y)) + 0.18
      : centerHeight + 0.3;
    this._titleMesh.position.set(0, topY, -radius);
    this.group.add(this._titleMesh);
  }

  _addCloseButton(centerHeight, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#442222';
    ctx.beginPath();
    this._roundRect(ctx, 0, 0, 192, 48, 8);
    ctx.fill();
    ctx.fillStyle = '#ff8888';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Close', 96, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.2, 0.05);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this._closeButton = new THREE.Mesh(geometry, material);
    this._closeButton.userData = { isCloseButton: true };

    const cards = Array.from(this.windowCards.values()).map(c => c.mesh);
    const bottomY = cards.length > 0
      ? Math.min(...cards.map(c => c.position.y)) - 0.18
      : centerHeight - 0.3;
    this._closeButton.position.set(0, bottomY, -radius);
    this.group.add(this._closeButton);
  }

  /**
   * Check if a raycaster hits a window card or the close button.
   */
  getCardAtIntersection(raycaster) {
    if (!this.group.visible) return null;
    const targets = [];
    for (const { mesh } of this.windowCards.values()) {
      targets.push(mesh);
    }
    if (this._closeButton) targets.push(this._closeButton);

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const obj = hits[0].object;
      if (obj.userData.isWindowCard) {
        return { sourceId: obj.userData.sourceId, mesh: obj, name: obj.userData.windowName };
      }
      if (obj.userData.isCloseButton) {
        return { action: 'close-picker' };
      }
    }
    return null;
  }
}
