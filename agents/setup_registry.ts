import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { getProvider, getWallet } from './src/utils/chain.js';
import { config } from './src/config.js';

const REGISTRY_ABI = JSON.parse(readFileSync('./registry_abi.json', 'utf8'));

async function setupRegistry() {
  const provider = getProvider();
  const orchestrator = await getWallet(provider);
  
  console.log(`Setting up Registry: ${config.REGISTRY_ADDRESS}`);
  console.log(`Orchestrator (owner): ${orchestrator.address}`);
  console.log(`Solace address: ${config.SOLACE_ADDRESS}\n`);
  
  const registry = new ethers.Contract(config.REGISTRY_ADDRESS, REGISTRY_ABI, orchestrator);
  
  const currentSolace = await registry.solace();
  console.log(`Current Solace address in Registry: ${currentSolace}`);
  
  if (currentSolace.toLowerCase() === config.SOLACE_ADDRESS.toLowerCase()) {
    console.log('✓ Solace address already set correctly!');
    return;
  }
  
  console.log('\nSetting Solace address...');
  const tx = await registry.setSolace(config.SOLACE_ADDRESS);
  await tx.wait();
  
  console.log('✓ Solace address set successfully!');
  
  const newSolace = await registry.solace();
  console.log(`New Solace address: ${newSolace}`);
}

setupRegistry().catch(console.error);
