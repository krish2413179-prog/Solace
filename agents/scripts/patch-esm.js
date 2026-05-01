#!/usr/bin/env node
/**
 * patch-esm.js
 * Runs after npm install (postinstall hook).
 * Adds .js extensions to all relative imports in dist/ so Node ESM works.
 * This fixes the issue where tsc with moduleResolution:bundler strips extensions.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

let patchedFiles = 0;
let patchedImports = 0;

function patchFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  // Match: from "./something" or from "../something" — only if no extension already
  const fixed = content.replace(
    /from\s+["'](\.\.?\/[^"']+?)["']/g,
    (match, importPath) => {
      if (/\.[a-zA-Z0-9]+$/.test(importPath)) return match; // already has extension
      patchedImports++;
      return match.replace(importPath, importPath + '.js');
    }
  );

  if (fixed !== content) {
    writeFileSync(filePath, fixed, 'utf8');
    patchedFiles++;
  }
}

function walkDir(dir) {
  if (!statSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full);
    } else if (extname(full) === '.js') {
      patchFile(full);
    }
  }
}

try {
  walkDir(distDir);
  if (patchedFiles > 0) {
    console.log(`✅ ESM patch: fixed ${patchedImports} imports in ${patchedFiles} files`);
  } else {
    console.log('✅ ESM patch: all imports already have .js extensions');
  }
} catch (e) {
  // dist/ doesn't exist yet — that's fine, tsc hasn't run
  console.log('ℹ️  ESM patch: dist/ not found, skipping');
}
