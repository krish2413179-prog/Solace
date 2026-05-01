import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { config } from './config.js';
async function checkBalances() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    console.log('\n💰 Checking balances for 20 workers...\n');
    let totalNeeded = 0;
    const lowBalanceWorkers = [];
    for (let i = 1; i <= 20; i++) {
        try {
            const keystorePath = `./keystores/worker${i}.json`;
            const keystore = JSON.parse(readFileSync(keystorePath, 'utf-8'));
            const address = `0x${keystore.address}`;
            const balance = await provider.getBalance(address);
            const balanceEth = parseFloat(ethers.formatEther(balance));
            // Each capability addition costs ~0.0001 A0GI gas
            // With 50 capabilities, need ~0.005 A0GI minimum
            const needed = balanceEth < 0.01;
            if (needed) {
                lowBalanceWorkers.push({
                    id: i,
                    address,
                    balance: balanceEth.toFixed(6)
                });
                totalNeeded += (0.01 - balanceEth);
            }
            const status = needed ? '❌ LOW' : '✅ OK';
            console.log(`Worker ${i.toString().padStart(2)}: ${address} | ${balanceEth.toFixed(6)} A0GI | ${status}`);
        }
        catch (error) {
            console.error(`Worker ${i} failed:`, error.message);
        }
    }
    console.log(`\n📊 Summary:`);
    console.log(`   Workers with low balance: ${lowBalanceWorkers.length}/20`);
    console.log(`   Total A0GI needed: ~${totalNeeded.toFixed(4)} A0GI\n`);
    if (lowBalanceWorkers.length > 0) {
        console.log(`⚠️  These workers need funding before adding capabilities:\n`);
        lowBalanceWorkers.forEach(w => {
            console.log(`   Worker ${w.id}: ${w.address} (has ${w.balance} A0GI)`);
        });
        console.log(`\n💡 Send ~0.01 A0GI to each address above\n`);
    }
    else {
        console.log(`✅ All workers have sufficient balance!\n`);
    }
}
checkBalances().catch(console.error);
//# sourceMappingURL=check_balances.js.map