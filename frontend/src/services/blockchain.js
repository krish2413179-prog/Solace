import { ethers } from 'ethers';

const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const SOLACE_ADDRESS = '0xbce5eF3265eBBBf8F36b82f7284fCF350526E598';
const REGISTRY_ADDRESS = '0xabCD2Fb66e944fEc7Ed420B4c3f56264b7F6681d';
export const BROKER_URL = 'https://solace-bvp0.onrender.com';

const SOLACE_ABI = [
  'function getPipelineCore(bytes32 id) external view returns (address orch, bytes32 parentId, uint256 deadline, uint256 bounty, uint256 delivered, uint256 accepted, uint256 total, uint8 depth, uint8 status)',
  'function getStepCount(bytes32 id) external view returns (uint256)',
  'function getStep(bytes32 id, uint256 i) external view returns (address agent, uint256 payout, bytes32 commitHash, bytes32 childPipelineId, uint8 status, uint256 disputeBlock, uint256 replacementDeadline)',
  'function getPipelineStatus(bytes32 id) external view returns (uint8)'
];

const REGISTRY_ABI = [
  'function getAvailableAgents() external view returns (address[])',
  'function getScore(address agent) external view returns (uint256)',
  'function isRegistered(address agent) external view returns (bool)',
  'function getAgentCapabilities(address agent) external view returns (string[])'
];

let provider = null;
let solaceContract = null;
let registryContract = null;

export function initBlockchain() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    solaceContract = new ethers.Contract(SOLACE_ADDRESS, SOLACE_ABI, provider);
    registryContract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  }
  return { provider, solaceContract, registryContract };
}

export async function getAgents() {
  const { registryContract } = initBlockchain();
  
  try {
    const addresses = await registryContract.getAvailableAgents();
    const limited = addresses.slice(0, 10);
    
    const agents = await Promise.all(
      limited.map(async (address, index) => {
        try {
          const score = await registryContract.getScore(address);
          let capabilities = [];
          try {
            capabilities = await registryContract.getAgentCapabilities(address);
          } catch {}
          
          return {
            id: index + 1,
            address,
            status: 'active',
            score: Number(score),
            capabilities,
            tasksCompleted: 0
          };
        } catch (error) {
          return {
            id: index + 1,
            address,
            status: 'unknown',
            score: 0,
            capabilities: [],
            tasksCompleted: 0
          };
        }
      })
    );
    
    return agents;
  } catch (error) {
    console.error('Error fetching agents:', error);
    // Fallback: return 10 mock agents with known capabilities from logs
    const KNOWN_CAPS = [
      'smart_contract_audit','security_research','code_review','static_analysis',
      'business_logic_audit','gas_optimization','test_coverage_analysis',
      'tokenomics_analysis','defi_risk_analysis','liquidity_analysis',
      'data_processing','ml_training','ml_aggregation','ml_validation',
      'ml_inference','model_deployment','data_scraping','data_collection',
      'nlp_preprocessing','text_preprocessing','sentiment_analysis',
      'sentiment_classification','ner','entity_extraction'
    ];
    return Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      address: `0x${'0'.repeat(40)}`,
      status: 'active',
      score: 75,
      capabilities: KNOWN_CAPS,
      tasksCompleted: 0
    }));
  }
}

export async function getPipeline(pipelineId) {
  const { solaceContract } = initBlockchain();
  
  try {
    const core = await solaceContract.getPipelineCore(pipelineId);
    const stepCount = await solaceContract.getStepCount(pipelineId);
    
    const steps = [];
    let completedSteps = 0;
    
    for (let i = 0; i < Number(stepCount); i++) {
      const step = await solaceContract.getStep(pipelineId, i);
      steps.push({
        index: i,
        agent: step[0],
        payout: ethers.formatEther(step[1]),
        status: Number(step[4])
      });
      
      // Status 3 = Delivered, 4 = Accepted
      if (Number(step[4]) >= 3) {
        completedSteps++;
      }
    }
    
    const statusMap = ['NonExistent', 'Pending', 'Active', 'FailedPending', 'Settled', 'RolledBack'];
    
    return {
      id: pipelineId,
      orchestrator: core[0],
      deadline: Number(core[2]),
      bounty: ethers.formatEther(core[3]),
      totalSteps: Number(stepCount),
      completedSteps,
      status: statusMap[Number(core[8])] || 'Unknown',
      steps
    };
  } catch (error) {
    console.error(`Error fetching pipeline ${pipelineId}:`, error);
    return null;
  }
}

export async function getStats() {
  const { registryContract } = initBlockchain();
  
  try {
    const agents = await registryContract.getAvailableAgents();
    
    return {
      totalAgents: agents.length,
      activeAgents: agents.length,
      completedTasks: 0, // Would need separate tracking
      activePipelines: 2 // Would need to track pipeline IDs
    };
  } catch (error) {
    console.error('Error fetching stats:', error);
    return {
      totalAgents: 0,
      activeAgents: 0,
      completedTasks: 0,
      activePipelines: 0
    };
  }
}

export const PIPELINE_IDS = [
  '0x80f78788957891e05681e290337fd79e4c37474d97beb976b9b7cd134290ff08',
  '0x4897acc3c5fe9172c36a06623e511cb9a5b5208f55b4a46ed957a74bea2c003a'
];
