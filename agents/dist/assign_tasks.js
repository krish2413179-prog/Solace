import { ethers } from 'ethers';
import * as fs from 'fs';
import { AXLClient } from './axl/client.js';
import { config } from './config.js';
const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;
const RPC_URL = process.env.RPC_URL || 'https://rpc-testnet.0g.ai';
const SOLACE_ADDRESS = process.env.SOLACE_ADDRESS || '';
const SOLACE_ABI = [
    'function getStepCount(bytes32 id) external view returns (uint256)',
    'function getStep(bytes32 id, uint256 i) external view returns (address agent, uint256 payout, bytes32 commitHash, bytes32 childPipelineId, uint8 status, uint256 disputeBlock, uint256 replacementDeadline)',
    'function getPipelineCore(bytes32 id) external view returns (address orch, bytes32 parentId, uint256 deadline, uint256 bounty, uint256 delivered, uint256 accepted, uint256 total, uint8 depth, uint8 status)'
];
async function assignTasks(pipelineId, taskFile) {
    console.log(`\n📋 Assigning tasks for pipeline: ${pipelineId}\n`);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const solace = new ethers.Contract(SOLACE_ADDRESS, SOLACE_ABI, provider);
    // Load task config
    const taskConfig = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
    // Get pipeline info
    const core = await solace.getPipelineCore(pipelineId);
    const stepCount = await solace.getStepCount(pipelineId);
    console.log(`📊 Pipeline has ${stepCount} steps`);
    console.log(`⏰ Deadline: ${new Date(Number(core[2]) * 1000).toLocaleString()}\n`);
    // Get agents and payouts
    const agents = [];
    const payouts = [];
    for (let i = 0; i < Number(stepCount); i++) {
        const step = await solace.getStep(pipelineId, i);
        agents.push(step[0]);
        payouts.push(parseFloat(ethers.formatEther(step[1])));
    }
    // Connect to broker
    const axl = new AXLClient(CHANNEL, 'orchestrator');
    console.log(`✅ Connected to broker`);
    console.log(`📢 Broadcasting TASK_ASSIGNMENT messages...\n`);
    // Broadcast TASK_ASSIGNMENT for each agent
    for (let i = 0; i < agents.length; i++) {
        const payload = {
            pipeline_id: pipelineId,
            step_index: i,
            payout_eth: payouts[i],
            deadline: Number(core[2]),
            min_score: taskConfig.min_score || 50,
            pipeline_type: taskConfig.type,
            task: {
                steps: taskConfig.steps,
                description: taskConfig.description
            },
            agents: agents,
            payouts_eth: payouts,
            target_agent: agents[i],
            timestamp: Date.now() / 1000
        };
        await axl.publish('TASK_ASSIGNMENT', payload);
        console.log(`   ✓ Step ${i}: ${agents[i].slice(0, 10)}... | ${taskConfig.steps[i].job}`);
    }
    console.log(`\n🎉 All task assignments broadcast!`);
    console.log(`🚀 Agents should now start executing\n`);
}
const pipelineId = process.argv[2];
const taskFile = process.argv[3];
if (!pipelineId || !taskFile) {
    console.log('Usage: npm run assign <pipeline_id> <task_file>');
    console.log('\nExample: npm run assign 0x80f78... tasks/sentiment_analysis.json');
    process.exit(1);
}
assignTasks(pipelineId, taskFile).catch(console.error);
//# sourceMappingURL=assign_tasks.js.map