import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { sendSponsoredTransaction } from './keeperhub/client.js';
import { getAvailableJobs } from './executors/index.js';

dotenv.config();

const AGENT_COUNT = 50;
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS!;

async function runVirtualAgent(id: number) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = ethers.Wallet.createRandom().connect(provider);
    
    console.log(`[Agent ${id}] Active: ${wallet.address}`);

    try {
        console.log(`[Agent ${id}] Registering via Sponsorship...`);
        const caps = getAvailableJobs();
        const registryAbi = ["function register(string[] caps) external payable", "function isRegistered(address) view returns (bool)", "function MIN_STAKE() view returns (uint256)"];
        const registry = new ethers.Contract(REGISTRY_ADDRESS, registryAbi, wallet);
        
        const minStake = await registry.MIN_STAKE();
        const data = registry.interface.encodeFunctionData("register", [caps]);

        await sendSponsoredTransaction(
            REGISTRY_ADDRESS,
            "register",
            [caps],
            registryAbi,
            minStake.toString()
        );

        console.log(`[Agent ${id}] Successfully Registered! Waiting for tasks...`);

        while (true) {
            await new Promise(r => setTimeout(r, 60000));
        }

    } catch (error: any) {
        console.error(`[Agent ${id}] Failed: ${error.message}`);
    }
}

async function startSwarm() {
    console.log(`🌩️  Starting Cloud Swarm: ${AGENT_COUNT} Agents...`);
    
    for (let i = 1; i <= AGENT_COUNT; i++) {
        runVirtualAgent(i);
        await new Promise(r => setTimeout(r, 1000));
    }
}

startSwarm().catch(console.error);
