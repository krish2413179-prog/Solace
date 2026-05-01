import { ethers } from 'ethers';
import { getProvider } from './utils/chain.js';
import { loadKeystore } from './utils/wallet.js';

async function fundWorker1() {
  const provider = getProvider();
  
  // Load orchestrator wallet (master wallet)
  const orchestrator = await loadKeystore('./keystores/orchestrator.json', 'password123');
  const master = orchestrator.connect(provider);
  
  const worker1Address = '0xce7f19c1580c2d8c2471423e57a6851b8b124653';
  const amount = ethers.parseEther('0.01'); // 0.01 A0GI
  
  console.log(`\n💰 Funding Worker 1...`);
  console.log(`From: ${master.address}`);
  console.log(`To: ${worker1Address}`);
  console.log(`Amount: ${ethers.formatEther(amount)} A0GI\n`);
  
  const balanceBefore = await provider.getBalance(master.address);
  console.log(`Master balance: ${ethers.formatEther(balanceBefore)} A0GI`);
  
  const tx = await master.sendTransaction({
    to: worker1Address,
    value: amount
  });
  
  console.log(`\n📤 Transaction sent: ${tx.hash}`);
  console.log(`⏳ Waiting for confirmation...`);
  
  await tx.wait();
  
  console.log(`✅ Worker 1 funded!`);
  
  const newBalance = await provider.getBalance(worker1Address);
  console.log(`Worker 1 balance: ${ethers.formatEther(newBalance)} A0GI\n`);
}

fundWorker1().catch(console.error);
