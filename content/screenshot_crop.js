/**
 * Rahi - Screenshot Drag-to-Crop Overlay Component (Manifest V3)
 * Implements interactive canvas selection overlay with DPI normalization (EC-4.1),
 * micro-selection fallback (EC-4.2), black-frame DRM detection (EC-4.3),
 * and clean Escape key cancellation (EC-4.4).
 */

let activeCropPromiseReject = null;

/**
 * Normalizes crop rectangle regardless of drag direction
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x, y, width, height };
}

/**
 * Checks if a canvas contains predominantly black pixels (DRM protected content)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @returns {boolean} True if > 98% of sampled pixels are black
 */
function isPredominantlyBlackFrame(ctx, width, height) {
  try {
    const sampleWidth = Math.min(width, 100);
    const sampleHeight = Math.min(height, 100);
    const imgData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    const data = imgData.data;
    let blackPixels = 0;
    const totalPixels = sampleWidth * sampleHeight;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Pixel is considered near black if rgb are all < 12
      if (r < 12 && g < 12 && b < 12) {
        blackPixels++;
      }
    }

    return (blackPixels / totalPixels) > 0.98;
  } catch (_) {
    return false;
  }
}

/**
 * Mounts interactive crop canvas overlay over the active viewport
 * @param {string} fullScreenshotUrl - Base64 DataURL of the captured visible tab
 * @returns {Promise<{ croppedDataUrl: string, isFullViewport: boolean, width: number, height: number, isDrmProtected: boolean }>}
 */
function startCropOverlay(fullScreenshotUrl) {
  teardownExistingOverlay();

  return new Promise((resolve, reject) => {
    activeCropPromiseReject = reject;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const overlayContainer = document.createElement('div');
      overlayContainer.id = 'rahi-crop-overlay-container';
      overlayContainer.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        cursor: crosshair !important;
        user-select: none !important;
        pointer-events: auto !important;
      `;

      // Info banner
      const banner = document.createElement('div');
      banner.style.cssText = `
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        border: 1px solid rgba(59, 130, 246, 0.5);
        border-radius: 8px;
        padding: 8px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      banner.innerHTML = '<span>📷 Drag to crop a region</span> <span style="opacity:0.6;">|</span> <span>Enter for full screen</span> <span style="opacity:0.6;">|</span> <span>Esc to cancel</span>';
      overlayContainer.appendChild(banner);

      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
      overlayContainer.appendChild(canvas);

      document.documentElement.appendChild(overlayContainer);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }

      function drawDimOverlay() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawDimOverlay();

      let isDragging = false;
      let startX = 0;
      let startY = 0;

      function onMouseDown(e) {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
      }

      function onMouseMove(e) {
        if (!isDragging) return;

        const currentX = e.clientX;
        const currentY = e.clientY;
        const rect = normalizeRect(startX, startY, currentX, currentY);

        drawDimOverlay();

        if (rect.width > 2 && rect.height > 2) {
          ctx.clearRect(rect.x, rect.y, rect.width, rect.height);

          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 2]);
          ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
          ctx.setLineDash([]);

          ctx.fillStyle = '#1e293b';
          ctx.fillRect(rect.x, Math.max(0, rect.y - 22), 80, 20);
          ctx.fillStyle = '#60a5fa';
          ctx.font = '11px sans-serif';
          ctx.fillText(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect.x + 6, Math.max(14, rect.y - 8));
        }
      }

      function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;

        const rect = normalizeRect(startX, startY, e.clientX, e.clientY);
        const isMicro = rect.width < 20 || rect.height < 20;
        finishCapture(isMicro ? null : rect);
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          reject(new Error('User cancelled screenshot crop.'));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          finishCapture(null);
        }
      }

      function finishCapture(selectionRect) {
        try {
          const offscreen = document.createElement('canvas');
          const offCtx = offscreen.getContext('2d');

          if (!selectionRect) {
            offscreen.width = img.naturalWidth || (window.innerWidth * dpr);
            offscreen.height = img.naturalHeight || (window.innerHeight * dpr);
            offCtx.drawImage(img, 0, 0);

            const isDrm = isPredominantlyBlackFrame(offCtx, offscreen.width, offscreen.height);
            const dataUrl = offscreen.toDataURL('image/png');
            cleanup();
            resolve({
              croppedDataUrl: dataUrl,
              isFullViewport: true,
              width: offscreen.width,
              height: offscreen.height,
              isDrmProtected: isDrm,
            });
            return;
          }

          // EC-4.1: High DPI scaling
          const cropX = Math.round(selectionRect.x * dpr);
          const cropY = Math.round(selectionRect.y * dpr);
          const cropW = Math.round(selectionRect.width * dpr);
          const cropH = Math.round(selectionRect.height * dpr);

          offscreen.width = cropW;
          offscreen.height = cropH;

          offCtx.drawImage(
            img,
            cropX, cropY, cropW, cropH,
            0, 0, cropW, cropH
          );

          const isDrm = isPredominantlyBlackFrame(offCtx, cropW, cropH);
          const croppedDataUrl = offscreen.toDataURL('image/png');

          cleanup();
          resolve({
            croppedDataUrl,
            isFullViewport: false,
            width: cropW,
            height: cropH,
            isDrmProtected: isDrm,
          });
        } catch (captureErr) {
          cleanup();
          reject(captureErr);
        }
      }

      function cleanup() {
        window.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        if (overlayContainer.parentNode) {
          overlayContainer.parentNode.removeChild(overlayContainer);
        }
        activeCropPromiseReject = null;
      }

      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);
    };

    img.onerror = () => {
      reject(new Error('Failed to load viewport screenshot image for cropping.'));
    };

    img.src = fullScreenshotUrl;
  });
}

function teardownExistingOverlay() {
  const existing = document.getElementById('rahi-crop-overlay-container');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
  if (activeCropPromiseReject) {
    activeCropPromiseReject(new Error('Crop overlay replaced.'));
    activeCropPromiseReject = null;
  }
}

// Global hooks for browser content script
if (typeof window !== 'undefined') {
  window.rahiStartCropOverlay = startCropOverlay;
  window.rahiNormalizeRect = normalizeRect;
  window.rahiIsPredominantlyBlackFrame = isPredominantlyBlackFrame;
}

// Module export for unit test runner
if (typeof globalThis !== 'undefined') {
  globalThis.rahiNormalizeRect = normalizeRect;
  globalThis.rahiIsPredominantlyBlackFrame = isPredominantlyBlackFrame;
  globalThis.rahiStartCropOverlay = startCropOverlay;
}
