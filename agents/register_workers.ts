import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { getProvider } from './src/utils/chain.js';
import { loadKeystore } from './src/utils/wallet.js';
import { config } from './src/config.js';

const REGISTRY_ABI = JSON.parse(readFileSync('./registry_abi.json', 'utf8'));

async function registerWorkers() {
  const provider = getProvider();
  const registry = new ethers.Contract(config.REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  
  console.log(`Registering 50 workers to Registry: ${config.REGISTRY_ADDRESS}\n`);
  
  const masterKey = process.env.MASTER_FUNDING_KEY;
  if (!masterKey) throw new Error('MASTER_FUNDING_KEY not set');
  
  const masterWallet = new ethers.Wallet(masterKey, provider);
  console.log(`Master wallet: ${masterWallet.address}\n`);
  
  const caps = ['smart_contract_audit', 'security_research', 'code_review'];
  const stakeAmount = ethers.parseEther('0.001');
  const password = 'password123';
  
  for (let i = 1; i <= 50; i++) {
    try {
      const keystorePath = `./keystores/worker${i}.json`;
      const workerWallet = await loadKeystore(keystorePath, password);
      const worker = workerWallet.connect(provider);
      
      const isRegistered = await registry.isRegistered(worker.address);
      if (isRegistered) {
        console.log(`Worker ${i} (${worker.address}) already registered ✓`);
        continue;
      }
      
      const balance = await provider.getBalance(worker.address);
      if (balance < stakeAmount + ethers.parseEther('0.001')) {
        console.log(`Worker ${i} needs funding first...`);
        const fundTx = await masterWallet.sendTransaction({
          to: worker.address,
          value: ethers.parseEther('0.005')
        });
        await fundTx.wait();
        console.log(`  Funded ✓`);
      }
      
      console.log(`Registering worker ${i} (${worker.address})...`);
      const tx = await registry.connect(worker).register(caps, { value: stakeAmount });
      await tx.wait();
      console.log(`  Registered ✓\n`);
      
    } catch (error: any) {
      console.error(`Worker ${i} failed:`, error.message);
    }
  }
  
  console.log('\nRegistration complete!');
  
  const availableAgents = await registry.getAvailableAgents();
  console.log(`\nTotal available agents: ${availableAgents.length}`);
}

registerWorkers().catch(console.error);
