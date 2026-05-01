/**
 * Generates the environment variable values needed for Render deployment.
 * Run: npm run gen:render-env
 * 
 * Outputs a render_env.txt file with all KEYSTORE_B64 values for workers 1-10.
 * Copy each value into the corresponding Render service's environment variables.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_FILE = 'render_env.txt';
const WORKER_COUNT = 10;

let output = '# Render Environment Variables\n';
output += '# Copy each KEYSTORE_B64 value into the corresponding Render worker service\n\n';

// Orchestrator
try {
  const orchPath = join(process.cwd(), 'keystores', 'orchestrator.json');
  const orchB64 = Buffer.from(readFileSync(orchPath, 'utf8')).toString('base64');
  output += `# ── Orchestrator ──\n`;
  output += `KEYSTORE_B64=${orchB64}\n\n`;
} catch (e) {
  output += `# Orchestrator keystore not found\n\n`;
}

// Workers 1-10
for (let i = 1; i <= WORKER_COUNT; i++) {
  try {
    const workerPath = join(process.cwd(), 'keystores', `worker${i}.json`);
    const workerB64 = Buffer.from(readFileSync(workerPath, 'utf8')).toString('base64');
    output += `# ── Worker ${i} (solace-worker-${i}) ──\n`;
    output += `KEYSTORE_B64=${workerB64}\n\n`;
  } catch (e) {
    output += `# Worker ${i} keystore not found\n\n`;
  }
}

// Common env vars
output += `\n# ── Common env vars (same for all services) ──\n`;
output += `RPC_URL=https://evmrpc-testnet.0g.ai\n`;
output += `OG_RPC_URL=https://evmrpc-testnet.0g.ai\n`;
output += `SOLACE_ADDRESS=0xbce5eF3265eBBBf8F36b82f7284fCF350526E598\n`;
output += `REGISTRY_ADDRESS=0xabCD2Fb66e944fEc7Ed420B4c3f56264b7F6681d\n`;
output += `KEYSTORE_PASSWORD=password123\n`;
output += `PIPELINE_CHANNEL_ID=0xSOLACE01\n`;
output += `OG_STORAGE_URL=https://indexer-storage-testnet-turbo.0g.ai\n`;
output += `OG_KV_URL=http://3.101.147.150:6789\n`;
output += `OG_STREAM_ID=0x000000000000000000000000000000000000000000000000000000000000f2bd\n`;
output += `PIPELINE_DURATION=600\n`;
output += `AXL_COMMIT_TIMEOUT=120000\n`;
output += `AXL_ACTIVE_TIMEOUT=180000\n`;
output += `AXL_POLL_INTERVAL=2000\n`;
output += `STATUS_POLL_INTERVAL=5000\n`;
output += `GAS_BUFFER=1.3\n`;
output += `TX_RETRIES=3\n`;
output += `TX_BACKOFF=2000\n`;
output += `LOG_LEVEL=info\n`;

writeFileSync(OUTPUT_FILE, output);
console.log(`\n✅ Generated ${OUTPUT_FILE}`);
console.log(`\n📋 Instructions:`);
console.log(`   1. Go to Render dashboard`);
console.log(`   2. For each worker service (solace-worker-1 through solace-worker-10):`);
console.log(`      - Open Environment Variables`);
console.log(`      - Set KEYSTORE_B64 to the corresponding value from ${OUTPUT_FILE}`);
console.log(`      - Set all common env vars listed at the bottom`);
console.log(`   3. For solace-broker, set AXL_BROKER_PORT=7777`);
console.log(`   4. For each worker, set AXL_BROKER_URL to the broker's Render URL`);
console.log(`      (e.g. https://solace-broker.onrender.com)\n`);
