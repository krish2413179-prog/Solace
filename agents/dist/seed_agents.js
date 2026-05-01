import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();
const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const REGISTRY_ADDRESS = '0x21cB38cA0AC6185C3aC4C17259c04BCE334Dc33c';
const MASTER_KEY = process.env.OG_COMPUTE_PRIVATE_KEY;
const iface = new ethers.Interface([
    'function registerAgent(string[] caps, string peerId) payable'
]);
async function seed() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const masterWallet = new ethers.Wallet(MASTER_KEY, provider);
    const capsOptions = [
        ['smart_contract_audit', 'security_research'],
        ['gas_optimization', 'code_review'],
        ['defi_risk_analysis', 'tokenomics'],
        ['static_analysis', 'vulnerability_scanning'],
        ['logic_check', 'formal_verification'],
        ['malware_analysis', 'threat_intel'],
        ['onchain_monitoring', 'alerting']
    ];
    console.log('Seeding 7 new agents with CORRECT ARGUMENT ORDER (caps, peerId)...');
    for (let i = 0; i < 7; i++) {
        const agentWallet = ethers.Wallet.createRandom().connect(provider);
        const peerId = `agent-${Math.floor(Math.random() * 100000)}`;
        const caps = capsOptions[i % capsOptions.length];
        console.log(`\nAgent ${i + 1}: ${agentWallet.address}`);
        const fundTx = await masterWallet.sendTransaction({
            to: agentWallet.address,
            value: ethers.parseEther('0.05')
        });
        await fundTx.wait();
        console.log(`  Funded`);
        const data = iface.encodeFunctionData('registerAgent', [caps, peerId]);
        const regTx = await agentWallet.sendTransaction({
            to: REGISTRY_ADDRESS,
            data: data,
            value: ethers.parseEther('0.01'),
            gasLimit: 1000000
        });
        console.log(`  Tx sent: ${regTx.hash}`);
        const receipt = await regTx.wait();
        if (receipt?.status === 1) {
            console.log(`  Registered successfully!`);
        }
        else {
            console.error(`  Registration FAILED`);
        }
    }
    console.log('\nSeed complete!');
}
seed().catch(console.error);
//# sourceMappingURL=seed_agents.js.map