/**
 * Generates environment variable values for Render deployment.
 * Run: npm run gen:render-env
 *
 * Outputs render_env.txt — copy these values into the Render dashboard
 * for the single "solace-swarm" web service.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const OUTPUT_FILE = 'render_env.txt';
const WORKER_COUNT = 10;
let output = '# ═══════════════════════════════════════════════════════════\n';
output += '# Render Environment Variables for "solace-swarm" service\n';
output += '# Copy each key=value into Render → Environment → Add Env Var\n';
output += '# ═══════════════════════════════════════════════════════════\n\n';
// Orchestrator keystore
try {
    const orchPath = join(process.cwd(), 'keystores', 'orchestrator.json');
    const orchB64 = Buffer.from(readFileSync(orchPath, 'utf8')).toString('base64');
    output += `ORCH_KEYSTORE_B64=${orchB64}\n\n`;
    console.log('✅ Orchestrator keystore encoded');
}
catch {
    output += `# ORCH_KEYSTORE_B64=<orchestrator keystore not found>\n\n`;
    console.warn('⚠️  Orchestrator keystore not found');
}
// Worker keystores
for (let i = 1; i <= WORKER_COUNT; i++) {
    try {
        const workerPath = join(process.cwd(), 'keystores', `worker${i}.json`);
        const workerB64 = Buffer.from(readFileSync(workerPath, 'utf8')).toString('base64');
        output += `WORKER_${i}_KEYSTORE_B64=${workerB64}\n\n`;
        console.log(`✅ Worker ${i} keystore encoded`);
    }
    catch {
        output += `# WORKER_${i}_KEYSTORE_B64=<not found>\n\n`;
        console.warn(`⚠️  Worker ${i} keystore not found`);
    }
}
// Common vars
output += `\n# ── Common (already in render.yaml, but listed here for reference) ──\n`;
output += `KEYSTORE_PASSWORD=password123\n`;
output += `WORKER_COUNT=10\n`;
output += `RPC_URL=https://evmrpc-testnet.0g.ai\n`;
output += `OG_RPC_URL=https://evmrpc-testnet.0g.ai\n`;
output += `SOLACE_ADDRESS=0xbce5eF3265eBBBf8F36b82f7284fCF350526E598\n`;
output += `REGISTRY_ADDRESS=0xabCD2Fb66e944fEc7Ed420B4c3f56264b7F6681d\n`;
output += `PIPELINE_CHANNEL_ID=0xSOLACE01\n`;
output += `OG_STORAGE_URL=https://indexer-storage-testnet-turbo.0g.ai\n`;
output += `OG_KV_URL=http://3.101.147.150:6789\n`;
output += `OG_STREAM_ID=0x000000000000000000000000000000000000000000000000000000000000f2bd\n`;
writeFileSync(OUTPUT_FILE, output);
console.log(`\n✅ Generated ${OUTPUT_FILE}\n`);
console.log('📋 Next steps:');
console.log('   1. Go to render.com → New → Blueprint → connect your repo');
console.log('   2. Render detects render.yaml and creates "solace-swarm" web service');
console.log('   3. In the service → Environment, add these secret vars from render_env.txt:');
console.log('      - ORCH_KEYSTORE_B64');
console.log('      - WORKER_1_KEYSTORE_B64 through WORKER_10_KEYSTORE_B64');
console.log('      - KEYSTORE_PASSWORD');
console.log('      - OG_COMPUTE_PRIVATE_KEY');
console.log('   4. Click Deploy — broker + orchestrator + 10 workers start automatically\n');
//# sourceMappingURL=gen_render_env.js.map