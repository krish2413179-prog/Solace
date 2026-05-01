/**
 * cloud_swarm.ts
 * 
 * Single entry point for Render deployment.
 * Starts: AXL Broker + Orchestrator + 10 Workers — all in one process.
 * 
 * Required env vars:
 *   KEYSTORE_PASSWORD   - password for all keystores
 *   WORKER_COUNT        - number of workers to start (default: 10)
 *   WORKER_KEYSTORES_B64 - comma-separated base64 encoded keystores for workers 1-N
 *   ORCH_KEYSTORE_B64   - base64 encoded orchestrator keystore
 *   RPC_URL, SOLACE_ADDRESS, REGISTRY_ADDRESS, etc.
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import http from 'http';

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT ?? '10');
const PASSWORD = process.env.KEYSTORE_PASSWORD ?? 'password123';
const PORT = parseInt(process.env.PORT ?? '8080'); // Render assigns PORT

// ── Write keystores from env vars ──────────────────────────────────────────

const keystoreDir = join(process.cwd(), 'keystores');
mkdirSync(keystoreDir, { recursive: true });

// Orchestrator keystore
const orchB64 = process.env.ORCH_KEYSTORE_B64;
if (orchB64) {
  writeFileSync(join(keystoreDir, 'orchestrator.json'), Buffer.from(orchB64, 'base64').toString('utf8'));
  console.log('✅ Orchestrator keystore written');
} else {
  console.warn('⚠️  ORCH_KEYSTORE_B64 not set — orchestrator will not start');
}

// Worker keystores — either individual WORKER_N_KEYSTORE_B64 or comma-separated WORKER_KEYSTORES_B64
const workerKeystoresB64 = process.env.WORKER_KEYSTORES_B64?.split(',') ?? [];

for (let i = 1; i <= WORKER_COUNT; i++) {
  const individual = process.env[`WORKER_${i}_KEYSTORE_B64`];
  const b64 = individual ?? workerKeystoresB64[i - 1];
  if (b64?.trim()) {
    writeFileSync(join(keystoreDir, `worker${i}.json`), Buffer.from(b64.trim(), 'base64').toString('utf8'));
    console.log(`✅ Worker ${i} keystore written`);
  } else {
    console.warn(`⚠️  Worker ${i} keystore not found — skipping`);
  }
}

// ── Health check HTTP server (Render requires a web service to respond) ────

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      workers: WORKER_COUNT,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Solace Agent Swarm — ${WORKER_COUNT} workers running`);
  }
});

server.listen(PORT, () => {
  console.log(`\n🌐 Health server listening on port ${PORT}`);
});

// ── Process management ─────────────────────────────────────────────────────

const processes: ChildProcess[] = [];

function spawnProcess(label: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, color: number) {
  const child = spawn(cmd, args, { env, shell: true, stdio: 'pipe' });

  child.stdout?.on('data', (data: Buffer) => {
    data.toString().split('\n').filter((l: string) => l.trim()).forEach((line: string) => {
      console.log(`\x1b[${color}m[${label}]\x1b[0m ${line}`);
    });
  });

  child.stderr?.on('data', (data: Buffer) => {
    data.toString().split('\n').filter((l: string) => l.trim()).forEach((line: string) => {
      console.error(`\x1b[31m[${label} ERR]\x1b[0m ${line}`);
    });
  });

  child.on('close', (code: number | null) => {
    console.log(`\x1b[33m[${label}]\x1b[0m exited with code ${code}`);
  });

  processes.push(child);
  return child;
}

const baseEnv = {
  ...process.env,
  KEYSTORE_PASSWORD: PASSWORD,
  PIPELINE_CHANNEL_ID: process.env.PIPELINE_CHANNEL_ID ?? '0xSOLACE01',
  AXL_BROKER_URL: `http://127.0.0.1:7777`,
  AXL_PORT: '7777',
};

// ── Step 1: Start broker ───────────────────────────────────────────────────

console.log('\n🚀 Starting AXL Broker...');
spawnProcess('Broker', 'npx', ['tsx', 'src/axl_broker.ts'], baseEnv, 36);

// ── Step 2: Start orchestrator after 3s ───────────────────────────────────

setTimeout(() => {
  if (!orchB64) return;

  console.log('\n🎯 Starting Orchestrator...');
  spawnProcess('Orch', 'npx', ['tsx', 'src/orchestrator.ts'], {
    ...baseEnv,
    KEYSTORE_PATH: './keystores/orchestrator.json',
  }, 35);
}, 3000);

// ── Step 3: Start workers staggered after 5s ──────────────────────────────

setTimeout(() => {
  console.log(`\n👷 Starting ${WORKER_COUNT} workers...\n`);

  for (let i = 1; i <= WORKER_COUNT; i++) {
    const keystorePath = `./keystores/worker${i}.json`;

    // Check keystore exists before spawning
    if (!existsSync(join(process.cwd(), 'keystores', `worker${i}.json`))) {
      console.warn(`⚠️  Skipping worker ${i} — keystore not found`);
      continue;
    }

    const delay = (i - 1) * 1500; // stagger 1.5s apart
    setTimeout(() => {
      const color = 30 + (i % 7) + 1;
      spawnProcess(`Worker${i}`, 'npx', ['tsx', 'src/worker.ts'], {
        ...baseEnv,
        KEYSTORE_PATH: keystorePath,
        AGENT_INDEX: i.toString(),
      }, color);
    }, delay);
  }
}, 5000);

// ── Graceful shutdown ──────────────────────────────────────────────────────

const shutdown = () => {
  console.log('\n🛑 Shutting down all processes...');
  processes.forEach(p => p.kill('SIGTERM'));
  server.close();
  setTimeout(() => process.exit(0), 3000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
