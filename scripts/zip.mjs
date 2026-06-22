// Package dist/ into immersive-bilingual.zip for the Chrome Web Store / Releases.
// Cross-platform, and the CONTENTS of dist/ go at the zip ROOT (manifest.json must be
// at the top level for the Web Store). Any stale zip is overwritten.
//
// On Windows we can't use `zip`, and PowerShell's Compress-Archive writes BACKSLASH
// path separators — which the Chrome Web Store mishandles for nested paths like
// icons/ — so we build the archive with .NET ZipArchive using forward-slash entry
// names instead.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'immersive-bilingual.zip';

if (!existsSync('dist')) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}
rmSync(OUT, { force: true });

if (platform() === 'win32') {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = (Resolve-Path 'dist').Path
$out = Join-Path (Get-Location).Path '${OUT}'
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel)
  }
} finally { $zip.Dispose() }
`.trim();
  const psPath = join(tmpdir(), 'ibt_zip.ps1');
  writeFileSync(psPath, ps);
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { stdio: 'inherit' });
  } finally {
    rmSync(psPath, { force: true });
  }
} else {
  execSync(`cd dist && zip -r -q ../${OUT} .`, { stdio: 'inherit' });
}

console.log(`zipped -> ${OUT}`);
