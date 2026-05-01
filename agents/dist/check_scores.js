import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { config } from './config.js';
const REGISTRY_ABI = JSON.parse(readFileSync('./registry_abi.json', 'utf8'));
async function checkScores() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const registry = new ethers.Contract(config.REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    console.log('\n📊 Checking agent scores...\n');
    for (let i = 1; i <= 25; i++) {
        try {
            const keystorePath = `./keystores/worker${i}.json`;
            const keystore = JSON.parse(readFileSync(keystorePath, 'utf-8'));
            const address = `0x${keystore.address}`;
            const score = await registry.getScore(address);
            const isAvailable = await registry.isAvailable(address);
            const isJailed = await registry.isJailed(address);
            const status = isJailed ? '🔒 JAILED' : isAvailable ? '✅ Available' : '❌ Unavailable';
            console.log(`Worker ${i.toString().padStart(2)}: ${address} | Score: ${score.toString().padStart(3)} | ${status}`);
        }
        catch (error) {
            console.error(`Worker ${i} failed:`, error.message);
        }
    }
    console.log('\n');
}
checkScores().catch(console.error);
//# sourceMappingURL=check_scores.js.map