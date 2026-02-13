/**
 * VR Button -- adapted from Three.js examples.
 * Creates an "Enter VR" button that handles WebXR session lifecycle.
 */
export class VRButton {
  static createButton(renderer, sessionInit = {}) {
    const button = document.createElement('button');

    function showEnterVR() {
      let currentSession = null;

      async function onSessionStarted(session) {
        session.addEventListener('end', onSessionEnded);
        await renderer.xr.setSession(session);
        button.textContent = 'EXIT VR';
        currentSession = session;
      }

      function onSessionEnded() {
        currentSession.removeEventListener('end', onSessionEnded);
        button.textContent = 'ENTER VR';
        currentSession = null;
      }

      button.style.cssText = `
        position: absolute; bottom: 20px; left: calc(50% - 75px);
        width: 150px; padding: 12px 6px;
        border: 1px solid #fff; border-radius: 4px;
        background: rgba(0,0,0,0.7); color: #fff;
        font: normal 13px sans-serif; text-align: center;
        cursor: pointer; z-index: 999;
        transition: background 0.2s;
      `;
      button.textContent = 'ENTER VR';
      button.onmouseenter = () => { button.style.background = 'rgba(0,0,0,0.9)'; };
      button.onmouseleave = () => { button.style.background = 'rgba(0,0,0,0.7)'; };

      button.onclick = () => {
        if (currentSession === null) {
          navigator.xr.requestSession('immersive-vr', sessionInit).then(onSessionStarted);
        } else {
          currentSession.end();
        }
      };
    }

    function showWebXRNotFound() {
      button.style.cssText = `
        position: absolute; bottom: 20px; left: calc(50% - 100px);
        width: 200px; padding: 12px 6px;
        border: 1px solid #f44; border-radius: 4px;
        background: rgba(0,0,0,0.7); color: #f44;
        font: normal 13px sans-serif; text-align: center;
        z-index: 999;
      `;
      button.textContent = 'WebXR NOT AVAILABLE';
      button.disabled = true;
    }

    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (supported) {
          showEnterVR();
        } else {
          showWebXRNotFound();
        }
      }).catch(showWebXRNotFound);
    } else {
      showWebXRNotFound();
    }

    return button;
  }
}
