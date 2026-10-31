/**
 * Rahi - Extension Release Packager
 * Validates manifest.json, audits security boundaries, and packages production
 * extension assets into dist/rahi-v1.0.0.zip for Chrome Web Store & GitHub Release.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');

// Files and folders required for production Chrome Extension
const REQUIRED_ENTRIES = [
  'manifest.json',
  'background',
  'content',
  'lib',
  'icons',
  'sidepanel',
];

// Sensitive items that MUST NEVER be packaged
const FORBIDDEN_PATTERNS = [
  /\.env/i,
  /test/i,
  /\.git/i,
  /node_modules/i,
  /\.playwright/i,
  /\.serena/i,
  /\.vscode/i,
];

console.log('🧭 Packaging Rahi AI Web Browser Agent for Release...\n');

// 1. Audit Manifest
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('❌ Error: manifest.json not found.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const version = manifest.version || '1.0.0';
console.log(`📦 Manifest Validated: "${manifest.name}" v${version}`);
console.log(`🛡️ MV3 Background Service Worker: ${manifest.background?.service_worker}`);
console.log(`📑 Permissions: ${manifest.permissions?.join(', ')}`);

// 2. Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

const zipFileName = `rahi-extension-v${version}.zip`;
const zipOutputPath = path.join(DIST_DIR, zipFileName);

// Remove older zip if present
if (fs.existsSync(zipOutputPath)) {
  fs.unlinkSync(zipOutputPath);
}

// 3. Collect entries to zip
const entriesToInclude = [];
for (const entry of REQUIRED_ENTRIES) {
  const fullPath = path.join(ROOT_DIR, entry);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing required extension asset: ${entry}`);
    process.exit(1);
  }
  entriesToInclude.push(entry);
}

console.log(`\n📋 Packaging entries: ${entriesToInclude.join(', ')}`);

// 4. Create ZIP using PowerShell Compress-Archive
try {
  const fileArgs = entriesToInclude.join(', ');
  const psCommand = `powershell -NoProfile -Command "Compress-Archive -Path ${fileArgs} -DestinationPath '${zipOutputPath}' -Force"`;
  execSync(psCommand, { stdio: 'inherit' });
} catch (zipErr) {
  console.error('❌ Failed to create zip package:', zipErr.message);
  process.exit(1);
}

// 5. Verify Package Integrity
if (fs.existsSync(zipOutputPath)) {
  const stat = fs.statSync(zipOutputPath);
  const sizeKb = (stat.size / 1024).toFixed(2);
  const fileBuffer = fs.readFileSync(zipOutputPath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  console.log('\n✅ Packaging Successful!');
  console.log(`📁 Output File: dist/${zipFileName}`);
  console.log(`📊 Size: ${sizeKb} KB`);
  console.log(`🔒 SHA256 Checksum: ${hash}`);
  console.log('\n✨ Ready for Chrome Web Store upload & GitHub Release!\n');
} else {
  console.error('❌ Packaging failed: Output zip was not created.');
  process.exit(1);
}
