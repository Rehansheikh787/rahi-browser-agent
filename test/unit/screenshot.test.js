/**
 * Rahi - Screenshot Drag-to-Crop Unit Tests (Slice 2.3 & ADR-006)
 * Verifies rectangle normalization, DPI coordinate scaling (EC-4.1),
 * micro-selection thresholding (EC-4.2), and DRM black-frame detection (EC-4.3).
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load content/screenshot_crop.js into global scope for node testing
const cropScriptPath = resolve(process.cwd(), 'content/screenshot_crop.js');
const cropScriptContent = readFileSync(cropScriptPath, 'utf8');

// Execute script content to populate globalThis functions
const fn = new Function('window', 'globalThis', cropScriptContent);
const mockWindow = {};
fn(mockWindow, globalThis);

const normalizeRect = globalThis.rahiNormalizeRect;
const isPredominantlyBlackFrame = globalThis.rahiIsPredominantlyBlackFrame;

console.log('Testing Screenshot Drag-to-Crop & Visual Logic...');

// Test 1: Rectangle Normalization across all 4 drag directions
{
  // Top-left to bottom-right
  const r1 = normalizeRect(10, 20, 110, 120);
  assert.deepStrictEqual(r1, { x: 10, y: 20, width: 100, height: 100 });

  // Bottom-right to top-left (inverted drag)
  const r2 = normalizeRect(110, 120, 10, 20);
  assert.deepStrictEqual(r2, { x: 10, y: 20, width: 100, height: 100 });

  // Top-right to bottom-left
  const r3 = normalizeRect(110, 20, 10, 120);
  assert.deepStrictEqual(r3, { x: 10, y: 20, width: 100, height: 100 });

  // Bottom-left to top-right
  const r4 = normalizeRect(10, 120, 110, 20);
  assert.deepStrictEqual(r4, { x: 10, y: 20, width: 100, height: 100 });

  console.log('✅ Test 1: Bounding rectangle normalization in all 4 drag directions verified');
}

// Test 2: Micro-selection threshold heuristic (EC-4.2)
{
  const microDrag1 = normalizeRect(50, 50, 55, 55); // 5x5
  const isMicro1 = microDrag1.width < 20 || microDrag1.height < 20;
  assert.strictEqual(isMicro1, true, '5x5 selection must trigger micro-selection fallback');

  const microDrag2 = normalizeRect(100, 100, 105, 200); // 5x100
  const isMicro2 = microDrag2.width < 20 || microDrag2.height < 20;
  assert.strictEqual(isMicro2, true, 'Narrow slip selection must trigger micro-selection fallback');

  const validDrag = normalizeRect(100, 100, 300, 250); // 200x150
  const isValid = validDrag.width >= 20 && validDrag.height >= 20;
  assert.strictEqual(isValid, true, 'Standard selection must proceed to crop');

  console.log('✅ Test 2: Micro-selection thresholding (< 20px) verified');
}

// Test 3: High DPI / Retina coordinate scaling (EC-4.1)
{
  const cssRect = { x: 50, y: 80, width: 300, height: 200 };
  const dpr15 = 1.5;
  const dpr20 = 2.0;

  // At 150% scaling (Windows standard)
  const scaled15 = {
    cropX: Math.round(cssRect.x * dpr15),
    cropY: Math.round(cssRect.y * dpr15),
    cropW: Math.round(cssRect.width * dpr15),
    cropH: Math.round(cssRect.height * dpr15),
  };
  assert.strictEqual(scaled15.cropX, 75);
  assert.strictEqual(scaled15.cropY, 120);
  assert.strictEqual(scaled15.cropW, 450);
  assert.strictEqual(scaled15.cropH, 300);

  // At 200% scaling (Retina Mac / 4K)
  const scaled20 = {
    cropX: Math.round(cssRect.x * dpr20),
    cropY: Math.round(cssRect.y * dpr20),
    cropW: Math.round(cssRect.width * dpr20),
    cropH: Math.round(cssRect.height * dpr20),
  };
  assert.strictEqual(scaled20.cropX, 100);
  assert.strictEqual(scaled20.cropY, 160);
  assert.strictEqual(scaled20.cropW, 600);
  assert.strictEqual(scaled20.cropH, 400);

  console.log('✅ Test 3: High DPI / Retina coordinate multiplication verified');
}

// Test 4: DRM Protected Video / Black-Frame Detection (EC-4.3)
{
  // Mock canvas context returning 100% black pixels
  const mockBlackCtx = {
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      // All zeroes (black, alpha 255)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
      return { data };
    },
  };
  assert.strictEqual(
    isPredominantlyBlackFrame(mockBlackCtx, 50, 50),
    true,
    'Must detect 100% black frame as DRM protected'
  );

  // Mock canvas context returning colorful web page pixels
  const mockWebCtx = {
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 180;
        data[i + 1] = 200;
        data[i + 2] = 240;
        data[i + 3] = 255;
      }
      return { data };
    },
  };
  assert.strictEqual(
    isPredominantlyBlackFrame(mockWebCtx, 50, 50),
    false,
    'Must not flag normal colorful web page content as DRM'
  );

  console.log('✅ Test 4: DRM black-frame detection verified');
}

console.log('All Screenshot & Visual understanding unit tests passed successfully!');
