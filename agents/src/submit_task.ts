import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://rpc-testnet.0g.ai';
const SOLACE_ADDRESS = process.env.SOLACE_ADDRESS || '0xYourSolaceContractAddress';
const ORCHESTRATOR_KEYSTORE = path.join(__dirname, '../keystores/orchestrator.json');
const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || 'password123';

// Solace contract ABI (minimal for task submission)
const SOLACE_ABI = [
  'function createPipeline(bytes32 id, uint256 deadline, string calldata pType, uint256 minScore, bytes32 parentPipelineId, uint256 parentStepIndex, address[] calldata agents, uint256[] calldata payouts, uint256[][] calldata dependsOn) external payable',
  'function getPipelineStatus(bytes32 id) external view returns (uint8)',
  'function getPipelineCore(bytes32 id) external view returns (address orch, bytes32 parentId, uint256 deadline, uint256 bounty, uint256 delivered, uint256 accepted, uint256 total, uint8 depth, uint8 status)',
  'event PipelineCreated(bytes32 indexed id, address indexed orch, bytes32 parentId, uint8 depth, uint256 bounty, uint256 deadline)'
];

interface TaskStep {
  id: number;
  job: string;
  input: string;
  dependsOn: number[];
  capability: string;
  complexity: number;
  payout_share: number;
  description?: string;
}

interface TaskConfig {
  type: string;
  description: string;
  bounty_eth: number;
  deadline_hours: number;
  min_score: number;
  steps: TaskStep[];
}

async function loadWallet(): Promise<ethers.Wallet> {
  const keystoreJson = fs.readFileSync(ORCHESTRATOR_KEYSTORE, 'utf-8');
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  return wallet.connect(provider);
}

function loadTaskConfig(taskName: string): TaskConfig {
  const taskPath = path.join(__dirname, `../tasks/${taskName}.json`);
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task file not found: ${taskPath}`);
  }
  return JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
}

function selectAgents(stepCount: number): string[] {
  // Load worker addresses from keystores
  const agents: string[] = [];
  for (let i = 1; i <= stepCount && i <= 25; i++) {
    const keystorePath = path.join(__dirname, `../keystores/worker${i}.json`);
    if (fs.existsSync(keystorePath)) {
      const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
      agents.push(`0x${keystore.address}`);
    }
  }
  return agents;
}

function calculatePayouts(totalBountyEth: number, steps: TaskStep[]): bigint[] {
  const totalBountyWei = ethers.parseEther(totalBountyEth.toString());
  return steps.map(step => {
    const share = BigInt(Math.floor(step.payout_share * 10000));
    return (totalBountyWei * share) / 10000n;
  });
}

function calculateInsurance(totalBounty: bigint): bigint {
  // 3% insurance (300 basis points)
  return (totalBounty * 300n) / 10000n;
}

async function submitTask(taskName: string) {
  console.log(`\n🚀 Submitting task: ${taskName}\n`);

  // Load task configuration
  const taskConfig = loadTaskConfig(taskName);
  console.log(`📋 Task: ${taskConfig.description}`);
  console.log(`💰 Bounty: ${taskConfig.bounty_eth} ETH`);
  console.log(`⏰ Deadline: ${taskConfig.deadline_hours} hours`);
  console.log(`📊 Steps: ${taskConfig.steps.length}`);
  console.log(`🎯 Min Score: ${taskConfig.min_score}\n`);

  // Load wallet
  console.log('🔑 Loading orchestrator wallet...');
  const wallet = await loadWallet();
  console.log(`✅ Orchestrator: ${wallet.address}\n`);

  // Connect to Solace contract
  const solace = new ethers.Contract(SOLACE_ADDRESS, SOLACE_ABI, wallet);

  // Generate pipeline ID
  const pipelineId = ethers.id(`${taskConfig.type}-${Date.now()}`);
  console.log(`🆔 Pipeline ID: ${pipelineId}\n`);

  // Select agents
  const agents = selectAgents(taskConfig.steps.length);
  console.log(`👥 Selected ${agents.length} agents:`);
  agents.forEach((agent, i) => console.log(`   Agent ${i + 1}: ${agent}`));
  console.log();

  // Calculate payouts
  const payouts = calculatePayouts(taskConfig.bounty_eth, taskConfig.steps);
  console.log(`💵 Payouts:`);
  taskConfig.steps.forEach((step, i) => {
    console.log(`   Step ${i}: ${ethers.formatEther(payouts[i])} ETH (${step.payout_share * 100}%)`);
  });
  console.log();

  // Prepare dependencies
  const dependencies = taskConfig.steps.map(step => step.dependsOn);

  // Calculate deadline
  const deadline = Math.floor(Date.now() / 1000) + (taskConfig.deadline_hours * 3600);
  const deadlineDate = new Date(deadline * 1000);
  console.log(`⏱️  Deadline: ${deadlineDate.toLocaleString()}\n`);

  // Calculate total value
  const totalBounty = payouts.reduce((sum, p) => sum + p, 0n);
  const insurance = calculateInsurance(totalBounty);
  const totalValue = totalBounty + insurance;

  console.log(`💎 Total Bounty: ${ethers.formatEther(totalBounty)} ETH`);
  console.log(`🛡️  Insurance: ${ethers.formatEther(insurance)} ETH (3%)`);
  console.log(`📦 Total Value: ${ethers.formatEther(totalValue)} ETH\n`);

  // Submit transaction
  console.log('📤 Submitting pipeline to blockchain...');
  try {
    const tx = await solace.createPipeline(
      pipelineId,
      deadline,
      taskConfig.type,
      taskConfig.min_score,
      ethers.ZeroHash, // No parent pipeline
      0, // No parent step
      agents,
      payouts,
      dependencies,
      { value: totalValue }
    );

    console.log(`⏳ Transaction sent: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...\n');

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`🎉 Pipeline created successfully!\n`);

    // Display task steps
    console.log('📝 Task Steps:');
    taskConfig.steps.forEach((step, i) => {
      const deps = step.dependsOn.length > 0 ? ` (depends on: ${step.dependsOn.join(', ')})` : '';
      console.log(`   ${i}. ${step.job}${deps}`);
      if (step.description) {
        console.log(`      ${step.description}`);
      }
    });

    console.log(`\n✨ Agents will now execute the task!`);
    console.log(`📊 Monitor progress with: npm run monitor ${pipelineId.slice(0, 10)}...\n`);

  } catch (error: any) {
    console.error('❌ Error submitting task:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    process.exit(1);
  }
}

// Main execution
const taskName = process.argv[2];

if (!taskName) {
  console.log('Usage: npm run submit <task_name>');
  console.log('\nAvailable tasks:');
  console.log('  - sentiment_analysis');
  console.log('  - data_labeling');
  console.log('  - distributed_model_training');
  console.log('  - prediction_market_validation');
  console.log('  - smart_contract_audit (task.json)');
  process.exit(1);
}

submitTask(taskName).catch(console.error);
