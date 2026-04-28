import { ethers } from "ethers";
import { readFileSync } from "fs";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, getSolace, getRegistry, sendTx, generatePipelineId, getPipeline, sleep } from "./utils/chain.js";
import { bytes32FromHex } from "./utils/hash.js";
import { AXLClient } from "./axl/client.js";

const logger  = getLogger("orchestrator");
const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;

interface TaskStep {
  agent_index: number;
  job:         string;
  input:       string;
  [key: string]: unknown;
}

interface Task {
  type:                   string;
  description:            string;
  required_capabilities?: string[];
  steps:                  TaskStep[];
}

async function discoverAgents(
  registry: ethers.Contract,
  caps:     string[],
): Promise<string[]> {
  logger.info(`Discovering agents with capabilities: ${caps.join(", ")}`);

  if (!caps.length) {
    return await registry.getAvailableAgents() as string[];
  }

  let agents: string[] = await registry.getAgentsByCapability(caps[0]);
  for (const cap of caps.slice(1)) {
    const capAgents = new Set(
      (await registry.getAgentsByCapability(cap) as string[]).map(a => a.toLowerCase())
    );
    agents = agents.filter(a => capAgents.has(a.toLowerCase()));
  }

  logger.info(`Found ${agents.length} matching agent(s)`);
  return agents;
}

async function broadcastTask(
  axl:        AXLClient,
  task:       Task,
  agents:     string[],
  payoutsEth: number[],
): Promise<void> {
  logger.info(`Broadcasting task to AXL channel ${CHANNEL.slice(0, 16)}...`);
  await axl.publish("TASK_REGISTRATION", {
    task,
    agents,
    payouts_eth: payoutsEth,
    timestamp:   Date.now() / 1000,
  });
}

async function collectCommits(
  axl:    AXLClient,
  agents: string[],
): Promise<Map<string, string>> {
  logger.info(`Collecting ${agents.length} commitment(s)...`);
  const msgs       = await axl.waitFor("COMMIT", agents.length, 0, config.AXL_COMMIT_TIMEOUT);
  const registered = new Set(agents.map(a => a.toLowerCase()));
  const commits    = new Map<string, string>();

  for (const msg of msgs) {
    const wallet = (msg.payload.wallet as string).toLowerCase();
    if (!registered.has(wallet)) continue;
    const hash = msg.payload.commit_hash as string;
    commits.set(wallet, hash);
    logger.info(`  [${wallet.slice(0, 12)}...] → ${hash.slice(0, 16)}...`);
  }

  const missing = agents.filter(a => !commits.has(a.toLowerCase()));
  if (missing.length) throw new Error(`Missing commits from: ${missing.join(", ")}`);

  return commits;
}

async function createPipeline(
  solace:       ethers.Contract,
  wallet:       ethers.Wallet,
  pipelineId:   string,
  deadline:     number,
  pipelineType: string,
  agents:       string[],
  payoutsWei:   bigint[],
): Promise<void> {
  const total = payoutsWei.reduce((a, b) => a + b, 0n);
  logger.info(`Creating pipeline on-chain | type: ${pipelineType}`);
  logger.info(`  ID      : ${pipelineId.slice(0, 16)}...`);
  logger.info(`  Agents  : ${agents.length}`);
  logger.info(`  Bounty  : ${ethers.formatEther(total)} ETH`);
  logger.info(`  Deadline: ${deadline - Math.floor(Date.now() / 1000)}s from now`);

  await sendTx(
    () => solace.createPipeline(
      pipelineId,
      deadline,
      pipelineType,
      agents.map(a => ethers.getAddress(a)),
      payoutsWei,
      { value: total },
    ),
    "createPipeline",
  );
}

async function lockCommitments(
  solace:     ethers.Contract,
  pipelineId: string,
  agents:     string[],
  commits:    Map<string, string>,
): Promise<void> {
  const ordered = agents.map(a => bytes32FromHex(commits.get(a.toLowerCase())!));
  logger.info(`Locking ${ordered.length} commitment(s) on-chain...`);
  await sendTx(
    () => solace.lockCommitments(pipelineId, ordered),
    "lockCommitments",
  );
}

async function notifyActive(axl: AXLClient, pipelineId: string): Promise<void> {
  await axl.publish("PIPELINE_ACTIVE", {
    pipeline_id: pipelineId,
    timestamp:   Date.now() / 1000,
  });
  logger.info("Agents notified: pipeline ACTIVE");
}

async function monitor(solace: ethers.Contract, pipelineId: string): Promise<string> {
  logger.info("Monitoring pipeline...");
  while (true) {
    const p = await getPipeline(solace, pipelineId);
    logger.info(`  Delivered: ${p.delivered}/${p.total} | Status: ${p.statusName}`);

    if (p.status === 4) { logger.info("SETTLED — all agents paid atomically"); return "settled"; }
    if (p.status === 5) { logger.warn("ROLLED BACK — bounty refunded");        return "rolled_back"; }

    await sleep(config.STATUS_POLL_INTERVAL);
  }
}

async function main() {
  const taskFile  = process.argv[2];
  if (!taskFile) throw new Error("Usage: npm run orchestrator <task_file.json> [agent1,agent2] [payout1,payout2]");

  const task: Task = JSON.parse(readFileSync(taskFile, "utf8"));

  const provider = getProvider();
  const wallet   = await getWallet(provider);
  const solace   = getSolace(wallet);
  const registry = getRegistry(wallet);
  const axl      = new AXLClient(CHANNEL, wallet.address);

  logger.info(`Orchestrator   : ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  logger.info(`Balance        : ${ethers.formatEther(balance)} ETH`);

  let agentWallets: string[] = [];
  let payoutsEth:   number[] = [];

  if (process.argv[3]) {
    agentWallets = process.argv[3].split(",");
    payoutsEth   = process.argv[4]?.split(",").map(Number) ?? agentWallets.map(() => 0.01);
  } else {
    const caps   = task.required_capabilities ?? [];
    agentWallets = await discoverAgents(registry, caps);
    agentWallets = agentWallets.slice(0, task.steps.length);
    const total  = 0.05;
    payoutsEth   = agentWallets.map(() => total / agentWallets.length);
    logger.info(`Auto-discovered ${agentWallets.length} agent(s)`);
  }

  if (agentWallets.length < task.steps.length) {
    throw new Error(`Not enough agents. Need ${task.steps.length}, found ${agentWallets.length}`);
  }

  const totalEth  = payoutsEth.reduce((a, b) => a + b, 0);
  const totalWei  = ethers.parseEther(totalEth.toFixed(18));
  if (totalWei > balance) throw new Error(`Insufficient balance. Need ${totalEth} ETH`);

  const pipelineId   = generatePipelineId(task);
  const deadline     = Math.floor(Date.now() / 1000) + config.PIPELINE_DURATION;
  const payoutsWei   = payoutsEth.map(p => ethers.parseEther(p.toFixed(18)));

  await broadcastTask(axl, task, agentWallets, payoutsEth);
  const commits = await collectCommits(axl, agentWallets);
  await createPipeline(solace, wallet, pipelineId, deadline, task.type, agentWallets, payoutsWei);
  await lockCommitments(solace, pipelineId, agentWallets, commits);
  await notifyActive(axl, pipelineId);
  const result = await monitor(solace, pipelineId);
  logger.info(`Pipeline result: ${result}`);
}

main().catch(e => { logger.error(String(e)); process.exit(1); });
