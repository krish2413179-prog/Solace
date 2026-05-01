import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dotenv from 'dotenv';
dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://rpc-testnet.0g.ai';
const SOLACE_ADDRESS = process.env.SOLACE_ADDRESS || '0xYourSolaceContractAddress';
const ORCHESTRATOR_KEYSTORE = path.join(__dirname, '../keystores/orchestrator.json');
const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || 'password123';

const SOLACE_ABI = [
  'function lockCommitments(bytes32 id, bytes32[] calldata hashes) external',
  'function getPipelineStatus(bytes32 id) external view returns (uint8)',
  'function getStepCount(bytes32 id) external view returns (uint256)',
  'function getStep(bytes32 id, uint256 i) external view returns (address agent, uint256 payout, bytes32 commitHash, bytes32 childPipelineId, uint8 status, uint256 disputeBlock, uint256 replacementDeadline)'
];

async function loadWallet(): Promise<ethers.Wallet> {
  const keystoreJson = fs.readFileSync(ORCHESTRATOR_KEYSTORE, 'utf-8');
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  return wallet.connect(provider) as ethers.Wallet;
}

async function lockCommitments(pipelineId: string) {
  console.log(`\n🔒 Locking commitments for pipeline: ${pipelineId}\n`);

  const wallet = await loadWallet();
  console.log(`✅ Orchestrator: ${wallet.address}\n`);

  const solace = new ethers.Contract(SOLACE_ADDRESS, SOLACE_ABI, wallet);

  // Check pipeline status
  const status = await solace.getPipelineStatus(pipelineId);
  if (Number(status) !== 1) {
    console.error(`❌ Pipeline is not in Pending status (status: ${status})`);
    process.exit(1);
  }

  // Get step count
  const stepCount = await solace.getStepCount(pipelineId);
  console.log(`📊 Pipeline has ${stepCount} steps`);

  // Generate commitment hashes (mock hashes for demonstration)
  const commitHashes: string[] = [];
  for (let i = 0; i < Number(stepCount); i++) {
    // Generate a deterministic hash for each step
    const hash = ethers.id(`step-${i}-commitment-${Date.now()}`);
    commitHashes.push(hash);
    console.log(`   Step ${i}: ${hash.slice(0, 16)}...`);
  }

  console.log(`\n🔐 Locking ${commitHashes.length} commitments...`);

  try {
    const tx = await solace.lockCommitments(pipelineId, commitHashes);
    console.log(`⏳ Transaction sent: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...\n');

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`🎉 Commitments locked! Pipeline is now Active!\n`);
    console.log(`✨ Agents can now start executing the tasks!\n`);

  } catch (error: any) {
    console.error('❌ Error locking commitments:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    process.exit(1);
  }
}

const pipelineId = process.argv[2];

if (!pipelineId) {
  console.log('Usage: npm run lock <pipeline_id>');
  console.log('\nExample: npm run lock 0x80f78788957891e05681e290337fd79e4c37474d97beb976b9b7cd134290ff08');
  process.exit(1);
}

lockCommitments(pipelineId).catch(console.error);
