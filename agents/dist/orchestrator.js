import { ethers } from "ethers";
import { readFileSync } from "fs";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, getSolace, getRegistry, sendTx, generatePipelineId, sleep, } from "./utils/chain.js";
import { bytes32FromHex } from "./utils/hash.js";
import { AXLClient } from "./axl/client.js";
import { registerPipelineWatcher } from "./keeperhub/client.js";
const logger = getLogger("orchestrator");
const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;
function getLocalSwarm() {
    try {
        const content = readFileSync("swarm_addresses.csv", "utf8");
        const lines = content.split("\n").slice(1);
        const addrs = lines.map(l => l.split(",")[1]?.trim().toLowerCase()).filter(Boolean);
        logger.info(`Loaded ${addrs.length} local agents from swarm_addresses.csv`);
        return new Set(addrs);
    }
    catch (e) {
        logger.warn("Could not load swarm_addresses.csv, will use any available agent");
        return new Set();
    }
}
const WHITELIST = getLocalSwarm();
const PIPE_STATUS = { NonExistent: 0, Pending: 1, Active: 2, FailedPending: 3, Settled: 4, RolledBack: 5 };
const STEP_STATUS_NAMES = {
    0: "Pending", 1: "Runnable", 2: "Committed",
    3: "Delivered", 4: "Accepted", 5: "Disputed", 6: "Failed",
};
async function discoverForStep(registry, step, minScore, excluded) {
    let candidates = [];
    if (step.capability) {
        try {
            candidates = (await registry.getAgentsByCapability(step.capability))
                .filter((a) => !excluded.has(a.toLowerCase()));
        }
        catch {
            candidates = [];
        }
    }
    if (!candidates.length) {
        candidates = (await registry.getAvailableAgents())
            .filter((a) => !excluded.has(a.toLowerCase()));
    }
    if (WHITELIST.size > 0) {
        const before = candidates.length;
        candidates = candidates.filter(a => WHITELIST.has(a.toLowerCase()));
        if (candidates.length === 0 && before > 0) {
            logger.warn(`Step ${step.id} (${step.job}): ${before} agents found in registry, but NONE are in your local swarm_addresses.csv`);
        }
    }
    const scored = [];
    for (const addr of candidates) {
        const isAvail = await registry.isAvailable(addr);
        if (!isAvail)
            continue;
        const score = Number(await registry.getScore(addr));
        if (score >= minScore)
            scored.push({ addr, score });
    }
    if (!scored.length)
        throw new Error(`No eligible agent for step ${step.id} (cap: ${step.capability ?? "any"})`);
    scored.sort((a, b) => b.score - a.score);
    return scored[0].addr;
}
async function assignAgents(registry, task, minScore) {
    logger.info(`Assigning agents to ${task.steps.length} steps...`);
    const totalShares = task.steps.reduce((s, st) => s + (st.payout_share ?? 1), 0);
    const assigned = [];
    const usedWallets = new Set();
    for (const step of task.steps) {
        const wallet = await discoverForStep(registry, step, minScore, usedWallets);
        usedWallets.add(wallet.toLowerCase());
        const share = step.payout_share ?? 1;
        const payoutEth = (task.bounty_eth * share) / totalShares;
        const payoutWei = ethers.parseEther(payoutEth.toFixed(18));
        assigned.push({ stepIndex: step.id, wallet, payoutEth, payoutWei });
        logger.info(`  Step ${step.id} → ${wallet.slice(0, 12)}... | ${payoutEth.toFixed(4)} ETH | job: ${step.job}`);
    }
    return assigned;
}
async function broadcastAssignments(axl, task, assignments, deadline, minScore, pipelineId) {
    logger.info("Broadcasting individual task assignments via AXL...");
    const allAgents = assignments.map(a => a.wallet);
    const allPayouts = assignments.map(a => a.payoutEth);
    for (const a of assignments) {
        const step = task.steps[a.stepIndex];
        await axl.publish("TASK_ASSIGNMENT", {
            pipeline_id: pipelineId,
            pipeline_type: task.type,
            step_index: a.stepIndex,
            target_agent: a.wallet,
            payout_eth: a.payoutEth,
            deadline,
            min_score: minScore,
            task: {
                description: task.description,
                required_capabilities: step.capability ? [step.capability] : [],
                steps: task.steps.map(s => ({
                    agent_index: s.id,
                    job: s.job,
                    input: s.input,
                    complexity: s.complexity ?? 50,
                    dependsOn: s.dependsOn,
                    maxSubAgents: s.maxSubAgents ?? 3,
                })),
            },
            agents: allAgents,
            payouts_eth: allPayouts,
            timestamp: Date.now() / 1000,
        });
        logger.info(`  Assignment sent → ${a.wallet.slice(0, 12)}... (step ${a.stepIndex})`);
    }
}
async function collectCommits(axl, agents, after) {
    logger.info(`Collecting ${agents.length} commitment(s)...`);
    const msgs = await axl.waitFor("COMMIT", agents.length, after, config.AXL_COMMIT_TIMEOUT);
    const registered = new Set(agents.map(a => a.toLowerCase()));
    const commits = new Map();
    for (const msg of msgs) {
        const wallet = msg.payload.wallet.toLowerCase();
        if (!registered.has(wallet))
            continue;
        commits.set(wallet, msg.payload.commit_hash);
        logger.info(`  ${wallet.slice(0, 12)}... → ${msg.payload.commit_hash.slice(0, 16)}...`);
    }
    const missing = agents.filter(a => !commits.has(a.toLowerCase()));
    if (missing.length)
        throw new Error(`Missing commits from: ${missing.join(", ")}`);
    return commits;
}
async function createPipeline(solace, pipelineId, deadline, task, assignments, commits, minScore) {
    const agents = assignments.map(a => ethers.getAddress(a.wallet));
    const payoutsWei = assignments.map(a => a.payoutWei);
    const dependsOn = task.steps.map(s => s.dependsOn);
    const total = payoutsWei.reduce((a, b) => a + b, 0n);
    const insurance = (total * 300n) / 10000n;
    const totalValue = total + insurance;
    logger.info(`Creating pipeline on-chain`);
    logger.info(`  ID       : ${pipelineId.slice(0, 16)}...`);
    logger.info(`  Steps    : ${agents.length}`);
    logger.info(`  Bounty   : ${ethers.formatEther(total)} ETH`);
    logger.info(`  Insurance: ${ethers.formatEther(insurance)} ETH`);
    logger.info(`  Deadline : ${deadline - Math.floor(Date.now() / 1000)}s from now`);
    await sendTx(() => solace.createPipeline(pipelineId, deadline, task.type, minScore, ethers.ZeroHash, 0, agents, payoutsWei, dependsOn, { value: totalValue }), "createPipeline");
    const orderedHashes = assignments.map(a => bytes32FromHex(commits.get(a.wallet.toLowerCase())));
    logger.info(`Locking ${orderedHashes.length} commitment(s)...`);
    await sendTx(() => solace.lockCommitments(pipelineId, orderedHashes), "lockCommitments");
}
async function monitorPipeline(solace, pipelineId, stepCount) {
    logger.info("Monitoring pipeline...");
    while (true) {
        const [, , , , delivered, accepted, total, , status] = await solace.getPipelineCore(pipelineId);
        const pStatus = Number(status);
        logger.info(`  Pipeline: ${config.PIPELINE_STATUS[pStatus] ?? pStatus} | Delivered: ${Number(delivered)}/${Number(total)} | Accepted: ${Number(accepted)}/${Number(total)}`);
        if (pStatus === PIPE_STATUS.Settled) {
            logger.info("SETTLED — all agents paid");
            return "settled";
        }
        if (pStatus === PIPE_STATUS.RolledBack) {
            logger.warn("ROLLED BACK — bounty refunded");
            return "rolled_back";
        }
        for (let i = 0; i < stepCount; i++) {
            try {
                const step = await solace.getStep(pipelineId, i);
                const sStatus = Number(step[4]);
                logger.info(`    Step ${i}: ${STEP_STATUS_NAMES[sStatus] ?? sStatus} | agent: ${step[0].slice(0, 12)}...`);
            }
            catch {
                logger.warn(`    Step ${i}: unable to read`);
            }
        }
        await sleep(config.STATUS_POLL_INTERVAL);
    }
}
async function main() {
    const taskFile = process.argv[2];
    if (!taskFile)
        throw new Error("Usage: npm run orchestrator <task_file.json>");
    const task = JSON.parse(readFileSync(taskFile, "utf8"));
    logger.info(`Task: ${task.description}`);
    logger.info(`Steps: ${task.steps.length} | Bounty: ${task.bounty_eth} ETH | Deadline: ${task.deadline_hours}h`);
    const provider = getProvider();
    const wallet = await getWallet(provider);
    const solace = getSolace(wallet);
    const registry = getRegistry(wallet);
    const axl = new AXLClient(CHANNEL, wallet.address);
    logger.info(`Orchestrator: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    logger.info(`Balance     : ${ethers.formatEther(balance)} ETH`);
    const minScore = task.min_score ?? 0;
    const deadline = Math.floor(Date.now() / 1000) + task.deadline_hours * 3600;
    let pipelineId = process.argv[3];
    const isExisting = !!pipelineId;
    if (!isExisting) {
        pipelineId = generatePipelineId(task);
        const assignments = await assignAgents(registry, task, minScore);
        const totalBountyWei = assignments.reduce((s, a) => s + a.payoutWei, 0n);
        const insurance = (totalBountyWei * 300n) / 10000n;
        const totalNeeded = totalBountyWei + insurance;
        if (balance < totalNeeded) {
            throw new Error(`Insufficient balance. Need ${ethers.formatEther(totalNeeded)} ETH, have ${ethers.formatEther(balance)} ETH`);
        }
        const broadcastAt = Date.now();
        await broadcastAssignments(axl, task, assignments, deadline, minScore, pipelineId);
        const allWallets = assignments.map(a => a.wallet);
        const commits = await collectCommits(axl, allWallets, broadcastAt);
        await createPipeline(solace, pipelineId, deadline, task, assignments, commits, minScore);
        await axl.publish("PIPELINE_ACTIVE", { pipeline_id: pipelineId, timestamp: Date.now() / 1000 });
        logger.info("Agents notified: PIPELINE_ACTIVE");
    }
    else {
        logger.info(`Attaching to existing pipeline: ${pipelineId}`);
        const assignments = await assignAgents(registry, task, minScore);
        await broadcastAssignments(axl, task, assignments, deadline, minScore, pipelineId);
        await axl.publish("PIPELINE_ACTIVE", { pipeline_id: pipelineId, timestamp: Date.now() / 1000 });
    }
    const network = await provider.getNetwork();
    await registerPipelineWatcher(pipelineId, deadline, task.steps.length, config.SOLACE_ADDRESS, Number(network.chainId));
    const result = await monitorPipeline(solace, pipelineId, task.steps.length);
    logger.info(`Final result: ${result}`);
}
main().catch(e => { logger.error(String(e)); process.exit(1); });
//# sourceMappingURL=orchestrator.js.map