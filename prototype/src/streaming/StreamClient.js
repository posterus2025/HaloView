/**
 * WebRTC streaming client for the VR viewer (Quest 3 browser).
 * Connects to the signaling server, negotiates WebRTC connections
 * with the PC capture peer, and provides MediaStreams for panels.
 */
export class StreamClient {
  constructor(signalingUrl) {
    this.signalingUrl = signalingUrl;
    this.ws = null;
    this.peerId = null;
    this.peerConnections = new Map(); // `${capturePeerId}:${panelId}` -> RTCPeerConnection
    this.dataChannels = new Map(); // panelId -> RTCDataChannel
    this.onStream = null; // callback(panelId, MediaStream)
    this.onInputChannel = null; // callback(panelId, dataChannel)
    this.onWindowList = null; // callback(windows[])
    this.capturePeers = [];
    this.capturePeerIds = []; // tracked for targeting capture-window requests
    this.onCapturePeerConnected = null; // callback(peerId) — fires when a new capture peer registers
  }

  /**
   * Connect to signaling server and register as a viewer.
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);

      this.ws.onopen = () => {
        console.log('[StreamClient] Connected to signaling server');
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this._handleSignal(msg);
        if (msg.type === 'welcome') {
          this.peerId = msg.peerId;
          this._send({ type: 'register', role: 'viewer' });
          console.log(`[StreamClient] Registered as viewer (peerId: ${this.peerId})`);

          // Check if any capture peers are already connected
          this.capturePeers = msg.peers.filter(p => p.role === 'capture');
          this.capturePeerIds = this.capturePeers.map(p => p.peerId);
          if (this.capturePeers.length > 0) {
            console.log(`[StreamClient] Found ${this.capturePeers.length} capture peer(s), requesting streams...`);
            for (const cp of this.capturePeers) {
              this._requestStreams(cp.peerId, cp.panelIds);
            }
          }

          // If the welcome includes a cached window list, surface it
          if (msg.windowList && this.onWindowList) {
            this.onWindowList(msg.windowList);
          }

          resolve();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[StreamClient] WebSocket error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[StreamClient] Disconnected from signaling server');
      };
    });
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async _handleSignal(msg) {
    switch (msg.type) {
      case 'peer-registered': {
        if (msg.role === 'capture') {
          console.log(`[StreamClient] Capture peer ${msg.peerId} registered with panels: [${msg.panelIds.join(', ')}]`);
          if (!this.capturePeerIds.includes(msg.peerId)) {
            this.capturePeerIds.push(msg.peerId);
          }
          this._requestStreams(msg.peerId, msg.panelIds);
          if (this.onCapturePeerConnected) {
            this.onCapturePeerConnected(msg.peerId);
          }
        }
        break;
      }

      case 'offer': {
        // Capture peer sent us an SDP offer for a specific panel
        const pc = this._getOrCreatePC(msg.fromId, msg.panelId);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._send({ type: 'answer', targetId: msg.fromId, sdp: pc.localDescription, panelId: msg.panelId });
        console.log(`[StreamClient] Sent answer to capture peer ${msg.fromId} for panel '${msg.panelId}'`);
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

      case 'window-list': {
        console.log(`[StreamClient] Received window list: ${msg.windows.length} windows`);
        if (this.onWindowList) {
          this.onWindowList(msg.windows);
        }
        break;
      }

      case 'peer-disconnected': {
        // Close all peer connections for the disconnected peer
        for (const [key, pc] of this.peerConnections) {
          if (key.startsWith(`${msg.peerId}:`)) {
            pc.close();
            this.peerConnections.delete(key);
          }
        }
        this.capturePeerIds = this.capturePeerIds.filter(id => id !== msg.peerId);
        console.log(`[StreamClient] Peer ${msg.peerId} disconnected`);
        break;
      }
    }
  }

  _requestStreams(capturePeerId, panelIds) {
    for (const panelId of panelIds) {
      this._send({ type: 'panel-request', panelId, targetId: capturePeerId });
    }
  }

  _getOrCreatePC(remotePeerId, panelId) {
    const key = `${remotePeerId}:${panelId}`;
    if (this.peerConnections.has(key)) {
      return this.peerConnections.get(key);
    }

    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    };

    const pc = new RTCPeerConnection(config);

    // Prefer H.264 High profile for screen content (better text quality than VP8)
    pc.ontrack = (event) => {
      console.log(`[StreamClient] Received track for panel '${panelId}': ${event.track.kind}`);
      // Try to prefer H.264 for screen content
      try {
        const transceiver = event.transceiver;
        if (transceiver && typeof RTCRtpReceiver.getCapabilities === 'function') {
          const caps = RTCRtpReceiver.getCapabilities('video');
          if (caps?.codecs) {
            // Put H.264 codecs first, then VP9, then VP8
            const h264 = caps.codecs.filter(c => c.mimeType === 'video/H264');
            const vp9 = caps.codecs.filter(c => c.mimeType === 'video/VP9');
            const rest = caps.codecs.filter(c => c.mimeType !== 'video/H264' && c.mimeType !== 'video/VP9');
            const preferred = [...h264, ...vp9, ...rest];
            transceiver.setCodecPreferences(preferred);
          }
        }
      } catch (e) {
        console.log(`[StreamClient] Could not set codec preference: ${e.message}`);
      }
      if (event.streams.length > 0 && this.onStream) {
        this.onStream(panelId, event.streams[0]);
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      console.log(`[StreamClient] Data channel opened: ${channel.label}`);
      // Extract panelId from channel label (format: "input:panelId")
      const channelPanelId = channel.label.startsWith('input:')
        ? channel.label.slice(6)
        : panelId;
      this.dataChannels.set(channelPanelId, channel);
      if (this.onInputChannel) {
        this.onInputChannel(channelPanelId, channel);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._send({
          type: 'ice-candidate',
          targetId: remotePeerId,
          panelId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[StreamClient] Connection state for panel '${panelId}': ${pc.connectionState}`);
    };

    this.peerConnections.set(key, pc);
    return pc;
  }

  /**
   * Request capture of a specific window (Electron capture app).
   */
  requestWindowCapture(targetCapturePeerId, sourceId, panelId, orientation = 'landscape') {
    this._send({
      type: 'capture-window',
      targetId: targetCapturePeerId,
      sourceId,
      panelId,
      orientation,
    });
  }

  /**
   * Request to stop a panel's stream.
   */
  releasePanel(targetCapturePeerId, panelId) {
    this._send({
      type: 'release-panel',
      targetId: targetCapturePeerId,
      panelId,
    });
    // Close the local peer connection for this panel
    const key = `${targetCapturePeerId}:${panelId}`;
    const pc = this.peerConnections.get(key);
    if (pc) {
      pc.close();
      this.peerConnections.delete(key);
    }
    this.dataChannels.delete(panelId);
  }

  /**
   * Ask capture peers for a fresh window list.
   */
  requestWindowList() {
    this._send({ type: 'request-window-list' });
  }

  /**
   * Send an input event to a specific panel's data channel.
   */
  sendInput(panelId, event) {
    const channel = this.dataChannels.get(panelId);
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(event));
    }
  }

  disconnect() {
    for (const [, pc] of this.peerConnections) {
      pc.close();
    }
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.ws?.close();
  }
}
