import { ethers } from 'ethers';
import { config } from './config.js';

const SOLACE_ABI = [
  'function getPipelineStatus(bytes32 id) external view returns (uint8)',
  'function getPipelineCore(bytes32 id) external view returns (address orch, bytes32 parentId, uint256 deadline, uint256 bounty, uint256 delivered, uint256 accepted, uint256 total, uint8 depth, uint8 status)',
  'function getStep(bytes32 id, uint256 i) external view returns (address agent, uint256 payout, bytes32 commitHash, bytes32 childPipelineId, uint8 status, uint256 disputeBlock, uint256 replacementDeadline)',
  'function getStepCount(bytes32 id) external view returns (uint256)'
];

const STATUS_NAMES = ['NonExistent', 'Pending', 'Active', 'FailedPending', 'Settled', 'RolledBack'];
const STEP_STATUS_NAMES = ['Pending', 'Runnable', 'Committed', 'Delivered', 'Accepted', 'Disputed', 'Failed'];

async function checkPipeline(pipelineId: string) {
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const solace = new ethers.Contract(config.SOLACE_ADDRESS, SOLACE_ABI, provider);
  
  console.log(`\n🔍 Checking Pipeline: ${pipelineId}\n`);
  
  try {
    const core = await solace.getPipelineCore(pipelineId);
    const stepCount = await solace.getStepCount(pipelineId);
    
    console.log(`📊 Pipeline Status: ${STATUS_NAMES[Number(core[8])]}`);
    console.log(`👤 Orchestrator: ${core[0]}`);
    console.log(`💰 Bounty: ${ethers.formatEther(core[3])} ETH`);
    console.log(`⏰ Deadline: ${new Date(Number(core[2]) * 1000).toLocaleString()}`);
    console.log(`📈 Progress: ${core[5]}/${core[6]} steps accepted`);
    console.log(`📦 Total Steps: ${stepCount}\n`);
    
    console.log(`📝 Step Details:`);
    for (let i = 0; i < Number(stepCount); i++) {
      const step = await solace.getStep(pipelineId, i);
      const status = STEP_STATUS_NAMES[Number(step[4])];
      const payout = ethers.formatEther(step[1]);
      console.log(`   Step ${i}: ${status.padEnd(10)} | Agent: ${step[0].slice(0, 10)}... | Payout: ${payout} ETH`);
    }
    
    console.log('\n');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

const pipelineId = process.argv[2];
if (!pipelineId) {
  console.log('Usage: npm run check:pipeline <pipeline_id>');
  console.log('\nExample: npm run check:pipeline 0x80f78788957891e05681e290337fd79e4c37474d97beb976b9b7cd134290ff08');
  process.exit(1);
}

checkPipeline(pipelineId).catch(console.error);
