/**
 * HaloView WebRTC Signaling Server
 *
 * Lightweight WebSocket server for LAN WebRTC signaling.
 * Peers register as either 'capture' (PC screen capture) or 'viewer' (Quest 3 browser).
 * Routes SDP offers/answers and ICE candidates between them.
 *
 * Usage: node src/signaling/server.js
 * Default port: 8080
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { networkInterfaces } from 'os';

const PORT = parseInt(process.env.SIGNAL_PORT || '8080', 10);

// Try to use the same self-signed certs as Vite for consistency
// If not available, fall back to plain WS (WebRTC still works on LAN without HTTPS signaling)
let server;
const certPath = 'node_modules/.vite/certs';
if (existsSync(`${certPath}/cert.pem`) && existsSync(`${certPath}/key.pem`)) {
  server = createServer({
    cert: readFileSync(`${certPath}/cert.pem`),
    key: readFileSync(`${certPath}/key.pem`),
  });
  console.log('[Signal] Using HTTPS (TLS)');
} else {
  server = null;
  console.log('[Signal] Using plain WebSocket (no TLS certs found)');
}

const wss = server
  ? new WebSocketServer({ server })
  : new WebSocketServer({ port: PORT });

// Track connected peers
const peers = new Map(); // peerId -> { ws, role, panelIds, windowList? }
let nextPeerId = 1;

wss.on('connection', (ws, req) => {
  const peerId = nextPeerId++;
  const remoteAddr = req.socket.remoteAddress;
  console.log(`[Signal] Peer ${peerId} connected from ${remoteAddr}`);

  peers.set(peerId, { ws, role: null, panelIds: [] });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      console.warn(`[Signal] Invalid JSON from peer ${peerId}`);
      return;
    }

    handleMessage(peerId, msg);
  });

  ws.on('close', () => {
    console.log(`[Signal] Peer ${peerId} disconnected (role: ${peers.get(peerId)?.role})`);
    peers.delete(peerId);
    // Notify remaining peers
    broadcast({ type: 'peer-disconnected', peerId });
  });

  ws.on('error', (err) => {
    console.error(`[Signal] Peer ${peerId} error:`, err.message);
  });

  // Send welcome with peer ID, list of existing peers, and cached window list
  const capturePeer = Array.from(peers.values()).find(p => p.role === 'capture' && p.windowList);
  send(ws, {
    type: 'welcome',
    peerId,
    peers: Array.from(peers.entries())
      .filter(([id]) => id !== peerId)
      .map(([id, p]) => ({ peerId: id, role: p.role, panelIds: p.panelIds })),
    windowList: capturePeer?.windowList || null,
  });
});

function handleMessage(fromId, msg) {
  const peer = peers.get(fromId);
  if (!peer) return;

  switch (msg.type) {
    case 'register': {
      // Peer declares its role: 'capture' (PC) or 'viewer' (Quest)
      peer.role = msg.role;
      peer.panelIds = msg.panelIds || [];
      console.log(`[Signal] Peer ${fromId} registered as '${msg.role}', panels: [${peer.panelIds.join(', ')}]`);
      broadcast({ type: 'peer-registered', peerId: fromId, role: msg.role, panelIds: peer.panelIds });
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      // Relay WebRTC signaling to target peer
      const target = peers.get(msg.targetId);
      if (target) {
        send(target.ws, { ...msg, fromId });
      } else {
        console.warn(`[Signal] Target peer ${msg.targetId} not found for ${msg.type}`);
      }
      break;
    }

    case 'panel-request': {
      // Viewer requests a new panel stream from capture peer
      const capturePeers = Array.from(peers.entries())
        .filter(([, p]) => p.role === 'capture');
      for (const [id, p] of capturePeers) {
        send(p.ws, { type: 'panel-request', fromId, panelId: msg.panelId });
      }
      break;
    }

    case 'window-list': {
      // Capture peer broadcasts available windows; cache and forward to viewers
      peer.windowList = msg.windows;
      for (const [id, p] of peers) {
        if (p.role === 'viewer') {
          send(p.ws, { type: 'window-list', fromId, windows: msg.windows });
        }
      }
      break;
    }

    case 'request-window-list': {
      // Viewer wants a fresh window list from all capture peers
      for (const [id, p] of peers) {
        if (p.role === 'capture') {
          send(p.ws, { type: 'request-window-list', fromId });
        }
      }
      break;
    }

    case 'capture-window':
    case 'release-panel': {
      // Viewer tells a capture peer to start/stop capturing a window
      const target = peers.get(msg.targetId);
      if (target && target.role === 'capture') {
        send(target.ws, { ...msg, fromId });
      }
      break;
    }

    default:
      console.log(`[Signal] Unknown message type '${msg.type}' from peer ${fromId}`);
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg, excludeId = null) {
  for (const [id, peer] of peers) {
    if (id !== excludeId) {
      send(peer.ws, msg);
    }
  }
}

// Start server
if (server) {
  server.listen(PORT, () => {
    printListening();
  });
} else {
  wss.on('listening', () => {
    printListening();
  });
}

function printListening() {
  console.log(`[Signal] Signaling server listening on port ${PORT}`);
  console.log('[Signal] LAN addresses:');
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const proto = server ? 'wss' : 'ws';
        console.log(`  ${name}: ${proto}://${addr.address}:${PORT}`);
      }
    }
  }
}
