import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
const WORKER_COUNT = 50;
const AGENTS_DIR = process.cwd();
const KEYSTORES_DIR = path.join(AGENTS_DIR, 'keystores');
const processes = [];
async function launchSwarm() {
    console.log(`🚀 Launching Swarm: ${WORKER_COUNT} Agents...`);
    const logsDir = path.join(AGENTS_DIR, 'logs');
    if (!fs.existsSync(logsDir))
        fs.mkdirSync(logsDir);
    for (let i = 1; i <= WORKER_COUNT; i++) {
        const keystoreFile = `worker${i}.json`;
        const keystorePath = path.join(KEYSTORES_DIR, keystoreFile);
        if (!fs.existsSync(keystorePath))
            continue;
        const logFile = path.join(logsDir, `worker${i}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        const workerProcess = spawn('npx', ['tsx', 'src/worker.ts'], {
            cwd: AGENTS_DIR,
            env: {
                ...process.env,
                KEYSTORE_PATH: `./keystores/${keystoreFile}`,
                KEYSTORE_PASSWORD: 'password123',
                WORKER_ID: i.toString(),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });
        workerProcess.stdout?.pipe(logStream);
        workerProcess.stderr?.pipe(logStream);
        workerProcess.on('close', (code) => {
            logStream.write(`\n[Worker ${i}] exited with code ${code}\n`);
            logStream.end();
            console.log(`[Worker ${i}] exited with code ${code}`);
        });
        processes.push(workerProcess);
        console.log(`[Worker ${i}] Started (PID: ${workerProcess.pid}) → logs/worker${i}.log`);
        await new Promise(r => setTimeout(r, 200));
    }
    console.log(`\n✅ ALL ${processes.length} WORKERS RUNNING. Ctrl+C to stop all.\n`);
    await new Promise((resolve) => {
        const shutdown = () => {
            console.log('\nShutting down all workers...');
            processes.forEach(p => p.kill('SIGINT'));
            setTimeout(() => resolve(), 2000);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
}
launchSwarm().catch(console.error);
//# sourceMappingURL=swarm_launcher.js.map