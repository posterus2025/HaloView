/**
 * PC-side screen capture client.
 * Run this in a browser on the PC to capture screens and stream them to Quest 3 via WebRTC.
 *
 * Open capture.html on the PC, select screens to share,
 * then open the VR app on Quest 3 -- they connect via the signaling server.
 */
export class CaptureClient {
  constructor(signalingUrl) {
    this.signalingUrl = signalingUrl;
    this.ws = null;
    this.peerId = null;
    this.streams = new Map(); // panelId -> MediaStream
    this.peerConnections = new Map(); // `${viewerPeerId}:${panelId}` -> RTCPeerConnection
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);

      this.ws.onopen = () => {
        console.log('[Capture] Connected to signaling server');
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this._handleSignal(msg);
        if (msg.type === 'welcome') {
          this.peerId = msg.peerId;
          const panelIds = Array.from(this.streams.keys());
          this._send({ type: 'register', role: 'capture', panelIds });
          console.log(`[Capture] Registered as capture (peerId: ${this.peerId}), panels: [${panelIds.join(', ')}]`);
          resolve();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Capture] WebSocket error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[Capture] Disconnected');
      };
    });
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Capture a screen/window using getDisplayMedia and assign it to a panel ID.
   */
  async captureScreen(panelId, options = {}) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        displaySurface: options.displaySurface || 'monitor',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: false,
    });

    // Hint encoder to prioritize resolution for text clarity
    const track = stream.getVideoTracks()[0];
    if (track) track.contentHint = 'text';

    this.streams.set(panelId, stream);
    console.log(`[Capture] Screen captured for panel '${panelId}'`);

    // Update signaling server with new panel
    this._send({
      type: 'register',
      role: 'capture',
      panelIds: Array.from(this.streams.keys()),
    });

    // Handle stream ending (user clicks "Stop sharing")
    stream.getVideoTracks()[0].onended = () => {
      console.log(`[Capture] Stream ended for panel '${panelId}'`);
      this.streams.delete(panelId);
    };

    return stream;
  }

  async _handleSignal(msg) {
    switch (msg.type) {
      case 'panel-request': {
        // Viewer wants a stream for a specific panel
        const stream = this.streams.get(msg.panelId);
        if (stream) {
          await this._sendStreamToViewer(msg.fromId, msg.panelId, stream);
        } else {
          console.warn(`[Capture] No stream for panel '${msg.panelId}'`);
        }
        break;
      }

      case 'answer': {
        const key = `${msg.fromId}:${msg.panelId}`;
        const pc = this.peerConnections.get(key);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          console.log(`[Capture] Received answer from viewer ${msg.fromId} for panel '${msg.panelId}'`);
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
        // Close all peer connections for this disconnected peer
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

    // Add video track
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    // Create data channel for input forwarding (labeled with panelId)
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

    // Boost bitrate for LAN — 8 Mbps for crisp text
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 8_000_000;
        await sender.setParameters(params);
      } catch (e) {
        console.warn(`[Capture] Could not set bitrate:`, e.message);
      }
    }

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._send({
      type: 'offer',
      targetId: viewerPeerId,
      sdp: pc.localDescription,
      panelId,
    });

    console.log(`[Capture] Sent offer to viewer ${viewerPeerId} for panel '${panelId}'`);
  }

  _handleRemoteInput(panelId, inputEvent) {
    // TODO: Forward input events to the appropriate virtual desktop
    console.log(`[Capture] Input on panel '${panelId}':`, inputEvent);
  }
}
