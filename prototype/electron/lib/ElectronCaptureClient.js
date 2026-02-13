/**
 * Electron-specific capture client.
 * Uses desktopCapturer + getUserMedia with chromeMediaSourceId for
 * programmatic window capture (no OS picker dialog).
 * Forwards VR input events to main process for Win32 mouse simulation.
 */
export class ElectronCaptureClient {
  constructor(signalingUrl) {
    this.signalingUrl = signalingUrl;
    this.ws = null;
    this.peerId = null;
    this.streams = new Map(); // panelId -> MediaStream
    this.peerConnections = new Map(); // `${viewerPeerId}:${panelId}` -> RTCPeerConnection
    this.captureInfo = new Map(); // panelId -> { sourceId, width, height }
    this.windowList = [];
    this._pollInterval = null;
    this._lastSourceIds = null;
    this.onStatusChange = null; // callback(status, text)
    this.onLog = null; // callback(msg, level)
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);

      this.ws.onopen = () => {
        this._log('Connected to signaling server');
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this._handleSignal(msg);
        if (msg.type === 'welcome') {
          this.peerId = msg.peerId;
          this._send({ type: 'register', role: 'capture', panelIds: Array.from(this.streams.keys()) });
          this._log(`Registered as capture peer #${this.peerId}`);
          if (this.onStatusChange) this.onStatusChange('connected', `Connected (peer #${this.peerId})`);
          resolve();
        }
      };

      this.ws.onerror = (err) => {
        this._log(`WebSocket error: ${err.message || err}`, 'err');
        if (this.onStatusChange) this.onStatusChange('error', 'Connection failed');
        reject(err);
      };

      this.ws.onclose = () => {
        this._log('Disconnected from signaling server', 'warn');
        if (this.onStatusChange) this.onStatusChange('disconnected', 'Disconnected');
        this._stopPolling();
      };
    });
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _log(msg, level = 'info') {
    console.log(`[Capture] ${msg}`);
    if (this.onLog) this.onLog(msg, level);
  }

  /**
   * Enumerate windows via Electron IPC and broadcast to viewers.
   */
  async enumerateWindows() {
    this.windowList = await window.haloCapture.enumerateWindows();
    return this.windowList;
  }

  /**
   * Start polling for window list changes and broadcasting.
   */
  startWindowPolling(intervalMs = 5000) {
    this._pollAndBroadcast();
    this._pollInterval = setInterval(() => this._pollAndBroadcast(), intervalMs);
  }

  _stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  async _pollAndBroadcast() {
    try {
      const list = await this.enumerateWindows();
      const currentIds = list.map(w => w.sourceId).sort().join(',');
      if (currentIds !== this._lastSourceIds) {
        this._lastSourceIds = currentIds;
        this._send({ type: 'window-list', windows: list });
        this._log(`Window list updated: ${list.length} windows`);
      }
    } catch (err) {
      this._log(`Window enumeration failed: ${err.message}`, 'err');
    }
  }

  /**
   * Programmatic capture of a specific window (no OS dialog).
   */
  async captureWindow(sourceId, panelId, orientation = 'landscape') {
    // Clean up existing stream for this panelId before re-capturing
    const existing = this.streams.get(panelId);
    if (existing) {
      existing.getTracks().forEach(t => t.stop());
      this.streams.delete(panelId);
      this.captureInfo.delete(panelId);
      this._log(`Stopped existing stream for panel '${panelId}'`);
    }

    const isPortrait = orientation === 'portrait';
    const isScreen = sourceId.startsWith('screen:');
    // Full screens: 2560x1440 for clarity. Individual windows: 1920x1080 (safer).
    const maxW = isScreen ? (isPortrait ? 1440 : 2560) : (isPortrait ? 1080 : 1920);
    const maxH = isScreen ? (isPortrait ? 2560 : 1440) : (isPortrait ? 1920 : 1080);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: maxW,
            maxHeight: maxH,
            maxFrameRate: 60,
          },
        },
      });
    } catch (err) {
      // Retry with lower resolution if first attempt fails
      this._log(`Capture failed at ${maxW}x${maxH}, retrying at 1280x720: ${err.message}`, 'warn');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: isPortrait ? 720 : 1280,
            maxHeight: isPortrait ? 1280 : 720,
            maxFrameRate: 30,
          },
        },
      });
    }

    // Hint encoder to prioritize resolution for text clarity
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.contentHint = 'text';

      // Store capture dimensions for input coordinate mapping
      const settings = track.getSettings();
      this.captureInfo.set(panelId, {
        sourceId,
        width: settings.width || maxW,
        height: settings.height || maxH,
      });
    }

    this.streams.set(panelId, stream);
    this._log(`Captured window '${sourceId}' as panel '${panelId}' (${orientation}, ${track?.getSettings().width}x${track?.getSettings().height}, contentHint=text)`);

    // Update registration with new panel
    this._send({
      type: 'register',
      role: 'capture',
      panelIds: Array.from(this.streams.keys()),
    });

    stream.getVideoTracks()[0].addEventListener('ended', () => {
      this._log(`Stream ended for panel '${panelId}'`, 'warn');
      this.streams.delete(panelId);
      this.captureInfo.delete(panelId);
    });

    return stream;
  }

  async _handleSignal(msg) {
    switch (msg.type) {
      case 'capture-window': {
        try {
          const stream = await this.captureWindow(msg.sourceId, msg.panelId, msg.orientation);
          await this._sendStreamToViewer(msg.fromId, msg.panelId, stream);
        } catch (err) {
          this._log(`Failed to capture window: ${err.message}`, 'err');
        }
        break;
      }

      case 'release-panel': {
        const stream = this.streams.get(msg.panelId);
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
          this.streams.delete(msg.panelId);
        }
        this.captureInfo.delete(msg.panelId);
        const key = `${msg.fromId}:${msg.panelId}`;
        const pc = this.peerConnections.get(key);
        if (pc) {
          pc.close();
          this.peerConnections.delete(key);
        }
        this._log(`Released panel '${msg.panelId}'`);
        break;
      }

      case 'request-window-list': {
        const list = await this.enumerateWindows();
        this._send({ type: 'window-list', windows: list });
        this._log(`Sent fresh window list (${list.length} windows) to viewer`);
        break;
      }

      case 'panel-request': {
        const stream = this.streams.get(msg.panelId);
        if (stream) {
          await this._sendStreamToViewer(msg.fromId, msg.panelId, stream);
        }
        break;
      }

      case 'answer': {
        const key = `${msg.fromId}:${msg.panelId}`;
        const pc = this.peerConnections.get(key);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          this._log(`Received answer from viewer ${msg.fromId} for panel '${msg.panelId}'`);
        }
        break;
      }

      case 'ice-candidate': {
        const key = `${msg.fromId}:${msg.panelId}`;
        const pc = this.peerConnections.get(key);
        if (pc && msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;
      }

      case 'peer-disconnected': {
        for (const [key, pc] of this.peerConnections) {
          if (key.startsWith(`${msg.peerId}:`)) {
            pc.close();
            this.peerConnections.delete(key);
          }
        }
        break;
      }
    }
  }

  async _sendStreamToViewer(viewerPeerId, panelId, stream) {
    const key = `${viewerPeerId}:${panelId}`;
    const config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };

    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(key, pc);

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    // Data channel for input forwarding from VR viewer
    const inputChannel = pc.createDataChannel(`input:${panelId}`, { ordered: true });
    inputChannel.onmessage = (event) => {
      const inputEvent = JSON.parse(event.data);
      this._handleRemoteInput(panelId, inputEvent);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._send({
          type: 'ice-candidate',
          targetId: viewerPeerId,
          panelId,
          candidate: event.candidate,
        });
      }
    };

    // Boost bitrate for LAN — 30 Mbps for crisp text at 2560x1440
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 30_000_000;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';
        await sender.setParameters(params);
      } catch (e) {
        this._log(`Could not set bitrate: ${e.message}`, 'warn');
      }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._send({
      type: 'offer',
      targetId: viewerPeerId,
      sdp: pc.localDescription,
      panelId,
    });

    this._log(`Sent offer to viewer ${viewerPeerId} for panel '${panelId}'`);
  }

  /**
   * Forward input events from VR viewer to the main process for Win32 simulation.
   */
  _handleRemoteInput(panelId, inputEvent) {
    const info = this.captureInfo.get(panelId);
    if (!info) {
      this._log(`No capture info for panel '${panelId}', ignoring input`, 'warn');
      return;
    }

    if (window.haloCapture?.simulateInput) {
      window.haloCapture.simulateInput({
        type: inputEvent.type,
        sourceId: info.sourceId,
        u: inputEvent.u,
        v: inputEvent.v,
        captureWidth: info.width,
        captureHeight: info.height,
        button: inputEvent.button,
        deltaY: inputEvent.deltaY,
      });
    }
  }
}
