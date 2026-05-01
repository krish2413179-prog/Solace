import { spawn, ChildProcess } from 'child_process';

const WORKER_COUNT = 25;
const processes: ChildProcess[] = [];

console.log(`Starting AXL Broker and ${WORKER_COUNT} agents...\n`);

const broker = spawn('npm', ['run', 'broker'], {
  shell: true,
  stdio: 'pipe'
});

broker.stdout?.on('data', (data) => {
  const lines = data.toString().split('\n').filter((l: string) => l.trim());
  lines.forEach((line: string) => console.log(`\x1b[36m[Broker]\x1b[0m ${line}`));
});

broker.stderr?.on('data', (data) => {
  const lines = data.toString().split('\n').filter((l: string) => l.trim());
  lines.forEach((line: string) => console.error(`\x1b[31m[Broker ERR]\x1b[0m ${line}`));
});

processes.push(broker);

setTimeout(() => {
  for (let i = 1; i <= WORKER_COUNT; i++) {
    const env = {
      ...process.env,
      KEYSTORE_PATH: `./keystores/worker${i}.json`,
      KEYSTORE_PASSWORD: 'password123',
      AGENT_INDEX: i.toString()
    };

    const worker = spawn('npm', ['run', 'worker'], {
      env,
      shell: true,
      stdio: 'pipe'
    });

    worker.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      lines.forEach((line: string) => {
        const colorCode = 30 + (i % 7) + 1;
        console.log(`\x1b[${colorCode}m[Worker ${i}]\x1b[0m ${line}`);
      });
    });

    worker.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      lines.forEach((line: string) => console.error(`\x1b[31m[Worker ${i} ERR]\x1b[0m ${line}`));
    });

    worker.on('close', (code) => {
      console.log(`[Worker ${i}] exited with code ${code}`);
    });

    processes.push(worker);
  }
}, 2000);

const shutdown = () => {
  console.log('\nShutting down all processes...');
  processes.forEach(p => p.kill('SIGINT'));
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
