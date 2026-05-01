import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
const KEYSTORES_DIR = path.join(process.cwd(), 'src', 'agents', 'keystores');
const PASSWORD = 'password123';
if (!fs.existsSync(KEYSTORES_DIR)) {
    fs.mkdirSync(KEYSTORES_DIR, { recursive: true });
}
async function generateSwarm(count) {
    console.log(`Generating ${count} agent keystores...`);
    const swarmInfo = [];
    for (let i = 1; i <= count; i++) {
        const wallet = ethers.Wallet.createRandom();
        const keystore = await wallet.encrypt(PASSWORD);
        const fileName = `worker${i}.json`;
        const filePath = path.join(KEYSTORES_DIR, fileName);
        fs.writeFileSync(filePath, JSON.stringify(keystore));
        swarmInfo.push({
            id: i,
            address: wallet.address,
            file: fileName
        });
        if (i % 10 === 0)
            console.log(`Progress: ${i}/${count}...`);
    }
    const csvContent = swarmInfo.map(info => `${info.id},${info.address},${info.file}`).join('\n');
    fs.writeFileSync(path.join(process.cwd(), 'src', 'agents', 'swarm_addresses.csv'), `id,address,file\n${csvContent}`);
    console.log('\n--- SWARM GENERATION COMPLETE ---');
    console.table(swarmInfo);
    console.log('\nFull list saved to: src/agents/swarm_addresses.csv');
}
generateSwarm(50).catch(console.error);
//# sourceMappingURL=generate_swarm.js.map