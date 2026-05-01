/**
 * cloud_swarm.ts — Memory-efficient Render deployment
 *
 * Runs broker inline + spawns workers as child processes using
 * pre-compiled JS (node dist/) instead of tsx — much lower memory.
 *
 * Build step: npm run build (tsc)
 * Start: node dist/cloud_swarm.js
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import http from 'http';

// ── Config ─────────────────────────────────────────────────────────────────

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT ?? '10');
const PASSWORD     = process.env.KEYSTORE_PASSWORD ?? 'password123';
const PORT         = parseInt(process.env.PORT ?? '8080');
const BROKER_PORT  = 7777;

// ── Write keystores from env vars ──────────────────────────────────────────

const keystoreDir = join(process.cwd(), 'keystores');
mkdirSync(keystoreDir, { recursive: true });

const orchB64 = process.env.ORCH_KEYSTORE_B64;
if (orchB64) {
  writeFileSync(join(keystoreDir, 'orchestrator.json'), Buffer.from(orchB64, 'base64').toString('utf8'));
  console.log('✅ Orchestrator keystore written');
}

let writtenWorkers = 0;
for (let i = 1; i <= WORKER_COUNT; i++) {
  const b64 = process.env[`WORKER_${i}_KEYSTORE_B64`];
  if (b64?.trim()) {
    writeFileSync(join(keystoreDir, `worker${i}.json`), Buffer.from(b64.trim(), 'base64').toString('utf8'));
    writtenWorkers++;
    console.log(`✅ Worker ${i} keystore written`);
  }
}

console.log(`\n📦 ${writtenWorkers}/${WORKER_COUNT} worker keystores ready\n`);

// ── Inline AXL Broker (no child process, no tsx overhead) ─────────────────

const MSG_TTL_MS = 3_600_000;
const channels   = new Map<string, any[]>();

const brokerServer = http.createServer(async (req, res) => {
  const url    = req.url ?? '/';
  const method = req.method ?? 'GET';

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = (): Promise<string> => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  const prune = (id: string) => {
    const cutoff = Date.now() - MSG_TTL_MS;
    channels.set(id, (channels.get(id) ?? []).filter((m: any) => m.timestamp * 1000 > cutoff));
  };

  if (url === '/health') return send(200, { status: 'ok', transport: 'http-rest' });

  const chanMatch = url.match(/^\/channel\/([^/]+)\/(publish|messages)$/);
  if (!chanMatch) return send(404, { error: 'not found' });

  const [, channelId, action] = chanMatch;
  if (!channels.has(channelId)) channels.set(channelId, []);
  prune(channelId);

  if (action === 'publish' && method === 'POST') {
    try {
      const msg = JSON.parse(await readBody());
      msg.timestamp = msg.timestamp ?? Date.now() / 1000;
      channels.get(channelId)!.push(msg);
      return send(200, { ok: true });
    } catch {
      return send(400, { error: 'bad json' });
    }
  }

  if (action === 'messages' && method === 'GET') {
    const qs      = url.includes('?') ? url.split('?')[1] : '';
    const params  = new URLSearchParams(qs);
    const after   = parseFloat(params.get('after') ?? '0');
    const limit   = parseInt(params.get('limit') ?? '100');
    const msgType = params.get('msg_type')?.toUpperCase();
    let msgs = (channels.get(channelId) ?? []).filter((m: any) => m.timestamp > after);
    if (msgType) msgs = msgs.filter((m: any) => m.msg_type?.toUpperCase() === msgType);
    return send(200, { messages: msgs.slice(-limit) });
  }

  return send(405, { error: 'method not allowed' });
});

brokerServer.listen(BROKER_PORT, () => {
  console.log(`🔌 AXL Broker running on port ${BROKER_PORT}`);
});

// ── Health server (Render requires HTTP on $PORT) ──────────────────────────

const processes: ChildProcess[] = [];

const healthServer = http.createServer((req, res) => {
  const alive = processes.filter(p => !p.killed).length;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    workers: writtenWorkers,
    alive_processes: alive,
    uptime: process.uptime()
  }));
});

healthServer.listen(PORT, () => {
  console.log(`🌐 Health server on port ${PORT}`);
});

// ── Spawn workers using compiled JS (node dist/) ───────────────────────────

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  KEYSTORE_PASSWORD:   PASSWORD,
  PIPELINE_CHANNEL_ID: process.env.PIPELINE_CHANNEL_ID ?? '0xSOLACE01',
  AXL_BROKER_URL:      `http://127.0.0.1:${BROKER_PORT}`,
};

function spawnWorker(index: number) {
  const keystorePath = `./keystores/worker${index}.json`;
  if (!existsSync(join(keystoreDir, `worker${index}.json`))) {
    console.warn(`⚠️  Skipping worker ${index} — keystore not found`);
    return;
  }

  const color = 31 + (index % 6);
  const label = `Worker${index}`;

  const child = spawn('node', ['dist/worker.js'], {
    env: { ...baseEnv, KEYSTORE_PATH: keystorePath, AGENT_INDEX: String(index) },
    stdio: 'pipe',
    shell: false,
  });

  child.stdout?.on('data', (d: Buffer) =>
    d.toString().split('\n').filter(Boolean).forEach(l =>
      console.log(`\x1b[${color}m[${label}]\x1b[0m ${l}`)
    )
  );
  child.stderr?.on('data', (d: Buffer) =>
    d.toString().split('\n').filter(Boolean).forEach(l =>
      console.error(`\x1b[31m[${label} ERR]\x1b[0m ${l}`)
    )
  );
  child.on('close', (code: number | null) => {
    console.log(`\x1b[33m[${label}]\x1b[0m exited (${code}) — restarting in 10s`);
    setTimeout(() => spawnWorker(index), 10_000); // auto-restart
  });

  processes.push(child);
}

// ── Start workers staggered after broker is ready ─────────────────────────

setTimeout(() => {
  console.log(`\n👷 Starting ${writtenWorkers} workers...\n`);
  for (let i = 1; i <= WORKER_COUNT; i++) {
    setTimeout(() => spawnWorker(i), (i - 1) * 3000);
  }
}, 1500);

// ── Graceful shutdown ──────────────────────────────────────────────────────

const shutdown = () => {
  console.log('\n🛑 Shutting down...');
  processes.forEach(p => p.kill('SIGTERM'));
  brokerServer.close();
  healthServer.close();
  setTimeout(() => process.exit(0), 3000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
