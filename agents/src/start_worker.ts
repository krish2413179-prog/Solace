/**
 * Render deployment entry point.
 * Reads KEYSTORE_B64 env var, writes it to disk, then starts the worker.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

const b64 = process.env.KEYSTORE_B64;
if (!b64) {
  console.error('KEYSTORE_B64 env var is not set');
  process.exit(1);
}

// Write keystore to disk
const keystoreDir = join(process.cwd(), 'keystores');
mkdirSync(keystoreDir, { recursive: true });

const keystorePath = join(keystoreDir, 'agent.json');
writeFileSync(keystorePath, Buffer.from(b64, 'base64').toString('utf8'));
console.log(`Keystore written to ${keystorePath}`);

// Set the path for the worker
process.env.KEYSTORE_PATH = './keystores/agent.json';

// Start the worker process
const worker = spawn('tsx', ['src/worker.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

worker.on('close', (code) => {
  console.log(`Worker exited with code ${code}`);
  process.exit(code ?? 1);
});

process.on('SIGINT', () => worker.kill('SIGINT'));
process.on('SIGTERM', () => worker.kill('SIGTERM'));
