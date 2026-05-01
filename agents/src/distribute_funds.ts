import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const MASTER_KEY = process.env.MASTER_FUNDING_KEY;
const CSV_PATH = path.join(process.cwd(), 'swarm_addresses.csv');
const FUND_AMOUNT = '0.005';

async function distribute() {
    if (!MASTER_KEY || MASTER_KEY.includes('your_master_private_key')) {
        console.error('ERROR: Please set MASTER_FUNDING_KEY in your .env file!');
        return;
    }

    if (!fs.existsSync(CSV_PATH)) {
        console.error('ERROR: swarm_addresses.csv not found. Run generate_swarm.ts first!');
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const masterWallet = new ethers.Wallet(MASTER_KEY, provider);
    const masterAddress = await masterWallet.getAddress();
    
    console.log(`Master Wallet: ${masterAddress}`);
    const balance = await provider.getBalance(masterAddress);
    console.log(`Master Balance: ${ethers.formatEther(balance)} A0GI`);

    const data = fs.readFileSync(CSV_PATH, 'utf8').split('\n').slice(1);
    const workers = data.filter(line => line.trim()).map(line => {
        const [id, address] = line.split(',');
        return { id, address };
    });

    console.log(`Starting distribution to ${workers.length} workers...`);

    for (const worker of workers) {
        try {
            const workerBalance = await provider.getBalance(worker.address);
            if (workerBalance >= ethers.parseEther('1.0')) {
                console.log(`Worker ${worker.id} (${worker.address}) already has ${ethers.formatEther(workerBalance)} A0GI. Skipping.`);
                continue;
            }

            console.log(`Funding Worker ${worker.id} (${worker.address}) with ${FUND_AMOUNT} A0GI...`);
            const tx = await masterWallet.sendTransaction({
                to: worker.address,
                value: ethers.parseEther(FUND_AMOUNT)
            });
            
            console.log(`Transaction sent: ${tx.hash}`);
            await tx.wait();
            console.log(`Worker ${worker.id} funded successfully!`);
        } catch (error) {
            console.error(`Failed to fund worker ${worker.id}:`, error);
        }
    }

    console.log('\n--- DISTRIBUTION COMPLETE ---');
}

distribute().catch(console.error);
