import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const WORKER_COUNT = 50;
const processes = [];

console.log('🚀 Starting Solace All-in-One...\n');

const broker = spawn('npm', ['run', 'broker:libp2p'], {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env }
});
processes.push(broker);
console.log('✅ Broker started');

setTimeout(() => {
  console.log('✅ Starting orchestrator...');
  const orchestrator = spawn('npm', ['run', 'orchestrator', 'task.json'], {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      KEYSTORE_PATH: './keystores/orchestrator.json',
      KEYSTORE_PASSWORD: process.env.KEYSTORE_PASSWORD_ORCH || process.env.KEYSTORE_PASSWORD
    }
  });
  processes.push(orchestrator);

  console.log(`✅ Starting ${WORKER_COUNT} workers...\n`);
  for (let i = 1; i <= WORKER_COUNT; i++) {
    const keystorePath = `./keystores/worker${i}.json`;
    
    if (!existsSync(keystorePath)) {
      console.warn(`⚠️  Keystore not found: ${keystorePath}, skipping worker ${i}`);
      continue;
    }

    const worker = spawn('npm', ['run', 'worker'], {
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        KEYSTORE_PATH: keystorePath,
        KEYSTORE_PASSWORD: process.env.KEYSTORE_PASSWORD_WORKER || 'password123',
        AGENT_INDEX: i.toString()
      }
    });

    worker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => console.log(`[W${i}] ${line}`));
    });

    worker.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => console.error(`[W${i} ERR] ${line}`));
    });

    worker.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ Worker ${i} exited with code ${code}`);
      }
    });

    processes.push(worker);
  }

  console.log(`\n✅ All services started! Total processes: ${processes.length}`);
}, 5000);

const shutdown = () => {
  console.log('\n🛑 Shutting down all processes...');
  processes.forEach(p => {
    try {
      p.kill('SIGTERM');
    } catch (e) {
      console.error('Error killing process:', e.message);
    }
  });
  setTimeout(() => process.exit(0), 2000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

setInterval(() => {
  const alive = processes.filter(p => !p.killed).length;
  console.log(`💓 Health: ${alive}/${processes.length} processes running`);
}, 60000);
