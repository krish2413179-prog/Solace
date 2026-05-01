/**
 * Decode Base64 keystores from environment variables
 * This should be run on Railway startup to recreate keystore files
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KEYSTORES_DIR = path.join(__dirname, 'keystores');

// Ensure keystores directory exists
if (!fs.existsSync(KEYSTORES_DIR)) {
  fs.mkdirSync(KEYSTORES_DIR, { recursive: true });
  console.log('Created keystores directory');
}

// Decode orchestrator keystore
const orchB64 = process.env.KEYSTORE_ORCH_B64;
if (orchB64) {
  const orchJson = Buffer.from(orchB64, 'base64').toString('utf-8');
  fs.writeFileSync(path.join(KEYSTORES_DIR, 'orchestrator.json'), orchJson);
  console.log('✓ Decoded orchestrator keystore');
} else {
  console.warn('⚠ KEYSTORE_ORCH_B64 not found in environment');
}

// Decode worker keystores
let workerCount = 0;
for (let i = 1; i <= 50; i++) {
  const workerB64 = process.env[`KEYSTORE_WORKER${i}_B64`];
  if (workerB64) {
    const workerJson = Buffer.from(workerB64, 'base64').toString('utf-8');
    fs.writeFileSync(path.join(KEYSTORES_DIR, `worker${i}.json`), workerJson);
    workerCount++;
  }
}

console.log(`✓ Decoded ${workerCount} worker keystores`);
console.log(`Total keystores: ${workerCount + (orchB64 ? 1 : 0)}`);
