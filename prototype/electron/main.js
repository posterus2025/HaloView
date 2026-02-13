const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, session, screen } = require('electron');
const path = require('path');

let mainWindow;
let tray;

// ── Win32 Input Simulation ──────────────────────────────────────────────
// Uses koffi (lightweight FFI) for direct Win32 API calls.
// Falls back gracefully if koffi isn't installed yet.
let user32 = null;
let SetCursorPos = null;
let mouse_event_fn = null;
let GetWindowRect = null;
let RECT = null;

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_WHEEL = 0x0800;

try {
  const koffi = require('koffi');
  user32 = koffi.load('user32.dll');

  SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
  mouse_event_fn = user32.func('void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, int32 dwData, uintptr_t dwExtraInfo)');

  RECT = koffi.struct('RECT', {
    left: 'int32',
    top: 'int32',
    right: 'int32',
    bottom: 'int32',
  });

  GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');

  console.log('[Main] koffi loaded — Win32 input simulation ready');
} catch (e) {
  console.warn('[Main] koffi not available — input simulation disabled. Run: cd electron && npm install');
}

// Cache window bounds to avoid per-frame Win32 calls
const windowBoundsCache = new Map(); // sourceId -> { x, y, width, height, _time }
const BOUNDS_CACHE_TTL = 3000; // 3 seconds

function getWindowBounds(sourceId) {
  const cached = windowBoundsCache.get(sourceId);
  if (cached && Date.now() - cached._time < BOUNDS_CACHE_TTL) {
    return cached;
  }

  // Parse HWND from sourceId format: "window:HWND:0"
  const match = sourceId.match(/^window:(\d+):/);
  if (match && GetWindowRect && RECT) {
    const hwnd = parseInt(match[1]);
    try {
      const rect = {};
      const ok = GetWindowRect(hwnd, rect);
      if (ok) {
        const bounds = {
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          _time: Date.now(),
        };
        windowBoundsCache.set(sourceId, bounds);
        return bounds;
      }
    } catch (e) {
      console.warn(`[Main] GetWindowRect failed for hwnd ${hwnd}:`, e.message);
    }
    return null;
  }

  // Screen capture — use Electron display bounds
  const screenMatch = sourceId.match(/^screen:(\d+):/);
  if (screenMatch) {
    const displays = screen.getAllDisplays();
    const displayIndex = parseInt(screenMatch[1]);
    const display = displays[displayIndex] || displays[0];
    return display ? display.bounds : null;
  }

  return null;
}

// ── App Setup ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Grant media permissions without prompts (required for chromeMediaSource: 'desktop')
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow = new BrowserWindow({
    width: 900,
    height: 550,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'HaloView Capture',
    backgroundColor: '#141422',
    show: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'capture-app.html'));

  // System tray
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Dashboard', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    tray.setToolTip('HaloView Capture');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
  } catch {
    console.log('[Main] No tray icon found, skipping system tray');
  }

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
});

// ── IPC Handlers ────────────────────────────────────────────────────────

// Window enumeration
ipcMain.handle('enumerate-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources
    .filter(s => s.name && s.name !== 'HaloView Capture')
    .map(s => ({
      sourceId: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL('image/jpeg', 0.7),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      display_id: s.display_id || null,
    }));
});

// Get window bounds for coordinate mapping
ipcMain.handle('get-window-bounds', async (event, sourceId) => {
  return getWindowBounds(sourceId);
});

// Input simulation — receives events from VR via DataChannel -> renderer -> IPC
ipcMain.handle('simulate-input', async (event, data) => {
  if (!SetCursorPos || !mouse_event_fn) {
    return { ok: false, error: 'koffi not loaded' };
  }

  const bounds = getWindowBounds(data.sourceId);
  if (!bounds) {
    return { ok: false, error: 'window bounds not found' };
  }

  // Convert UV (0-1) to absolute screen coordinates
  const absX = Math.round(bounds.x + (data.u || 0) * bounds.width);
  const absY = Math.round(bounds.y + (data.v || 0) * bounds.height);

  try {
    switch (data.type) {
      case 'mousemove':
        SetCursorPos(absX, absY);
        break;

      case 'mousedown':
        SetCursorPos(absX, absY);
        mouse_event_fn(
          data.button === 2 ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN,
          0, 0, 0, 0
        );
        break;

      case 'mouseup':
        mouse_event_fn(
          data.button === 2 ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP,
          0, 0, 0, 0
        );
        break;

      case 'click':
        SetCursorPos(absX, absY);
        mouse_event_fn(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event_fn(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        break;

      case 'scroll':
        SetCursorPos(absX, absY);
        // WHEEL_DELTA = 120 per notch; deltaY from VR is scaled
        mouse_event_fn(MOUSEEVENTF_WHEEL, 0, 0, -(data.deltaY || 0) * 40, 0);
        break;
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.on('window-all-closed', () => {
  // Don't quit — we live in the tray
});
