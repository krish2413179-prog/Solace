import { ethers } from "ethers";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, getSolace, getRegistry, sendTx, sleep } from "./utils/chain.js";
import { hashOutput } from "./utils/hash.js";
import { AXLClient } from "./axl/client.js";
import { execute, getAvailableJobs } from "./executors/index.js";
import { persistTaskRecord } from "./og/storage.js";

process.on('uncaughtException', (e) => {
  console.error('FULL ERROR:', e);
  console.error(e.stack);
});

const logger = getLogger("worker");

const CHANNEL    = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;
const AGENT_IDX  = process.env.AGENT_INDEX ? parseInt(process.env.AGENT_INDEX) : null;

interface Step {
  agent_index: number;
  job:         string;
  input:       string;
  [key: string]: unknown;
}

interface TaskPayload {
  task:        { steps: Step[]; required_capabilities?: string[] };
  agents:      string[];
  payouts_eth: number[];
  timestamp:   number;
}

async function ensureRegistered(
  registry: ethers.Contract,
  wallet:   ethers.Wallet,
): Promise<void> {
  const isReg = await registry.isRegistered(wallet.address);
  if (isReg) {
    logger.info("Already registered on AgentRegistry");
    return;
  }

  const capabilities = getAvailableJobs();
  const minStake     = await registry.MIN_STAKE() as bigint;

  logger.info(`Registering with capabilities: ${capabilities.join(", ")}`);
  await sendTx(
    () => registry.registerAgent(capabilities, config.AXL_PEER_ID, { value: minStake }),
    "registerAgent",
  );
  logger.info(`Registered | stake: ${ethers.formatEther(minStake)} ETH`);
}

async function waitForTask(axl: AXLClient, address: string): Promise<TaskPayload> {
  logger.info(`Listening for task on channel ${CHANNEL.slice(0, 16)}...`);
  while (true) {
    const msgs = await axl.poll("TASK_REGISTRATION", 0);
    for (const msg of msgs) {
      const payload = msg.payload as TaskPayload;
      if (!payload?.agents?.length) continue;
      const agents = payload.agents.map((a: string) => a.toLowerCase());
      if (agents.includes(address.toLowerCase())) {
        logger.info(`Task accepted from ${msg.sender.slice(0, 12)}...`);
        return payload;
      }
    }
    await sleep(config.AXL_POLL_INTERVAL);
  }
}

function resolveIndex(payload: TaskPayload, address: string): number {
  const agents = payload.agents.map(a => a.toLowerCase());
  const idx    = agents.indexOf(address.toLowerCase());
  if (idx === -1) throw new Error(`Wallet ${address} not in agents list`);
  logger.info(`Agent index: ${idx}`);
  return idx;
}

function resolveStep(payload: TaskPayload, agentIndex: number): Step {
  const step = payload.task.steps.find(s => s.agent_index === agentIndex);
  if (!step) throw new Error(`No step defined for agent_index ${agentIndex}`);
  return step;
}

async function sendCommit(
  axl:     AXLClient,
  address: string,
  output:  string,
): Promise<string> {
  const hash = hashOutput(output);
  await axl.publish("COMMIT", {
    wallet:      address.toLowerCase(),
    commit_hash: hash,
    timestamp:   Date.now() / 1000,
  });
  logger.info(`Commitment sent: ${hash.slice(0, 16)}...`);
  return hash;
}

async function waitForPipelineActive(
  axl:        AXLClient,
  solace:     ethers.Contract,
  startedAt:  number,
): Promise<string> {
  logger.info("Waiting for PIPELINE_ACTIVE signal...");
  const msgs       = await axl.waitFor("PIPELINE_ACTIVE", 1, startedAt, config.AXL_ACTIVE_TIMEOUT);
  const pipelineId = msgs[0].payload.pipeline_id as string;
  const status     = await solace.getPipelineStatus(pipelineId) as bigint;

  if (Number(status) !== 2) {
    throw new Error(`Expected Active(2), got ${config.PIPELINE_STATUS[Number(status)]}`);
  }
  logger.info(`Pipeline ACTIVE | ID: ${pipelineId.slice(0, 16)}...`);
  return pipelineId;
}

async function main() {
  const provider = getProvider();
  const wallet   = await getWallet(provider);
  const solace   = getSolace(wallet);
  const registry = getRegistry(wallet);
  const axl      = new AXLClient(CHANNEL, wallet.address);

  logger.info(`Worker wallet  : ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  logger.info(`Balance        : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) throw new Error("Worker wallet has 0 ETH. Fund it.");

  await ensureRegistered(registry, wallet);

  const startedAt    = Date.now();
  const taskPayload  = await waitForTask(axl, wallet.address);
  const agentIndex   = AGENT_IDX ?? resolveIndex(taskPayload, wallet.address);
  const step         = resolveStep(taskPayload, agentIndex);

  const { job, input } = step;
  const params = Object.fromEntries(
    Object.entries(step).filter(([k]) => !["job", "input", "agent_index"].includes(k))
  ) as Record<string, unknown>;

  const output = await execute(wallet, job, input, params);
  await sendCommit(axl, wallet.address, output);

  const pipelineId = await waitForPipelineActive(axl, solace, startedAt);
  const outputHash = hashOutput(output);

  logger.info(`Submitting work on-chain | hash: ${outputHash.slice(0, 16)}...`);
  const receipt = await sendTx(
    () => solace.submitWork(pipelineId, outputHash),
    "submitWork",
  );
  logger.info(`Work submitted | TX: ${receipt.hash}`);

  await persistTaskRecord(wallet, {
    agentWallet:  wallet.address,
    pipelineId,
    jobType:      job,
    outputHash,
    bountyEth:    String(taskPayload.payouts_eth[agentIndex] ?? 0),
    onTime:       true,
    timestamp:    Date.now(),
    pipelineType: taskPayload.task?.required_capabilities?.[0] ?? "general",
  });

  while (true) {
    const status     = await solace.getPipelineStatus(pipelineId) as bigint;
    const statusNum  = Number(status);
    const statusName = config.PIPELINE_STATUS[statusNum] ?? "Unknown";
    logger.info(`Pipeline status: ${statusName}`);

    if (statusNum === 4) { logger.info("SETTLED — payout received"); break; }
    if (statusNum === 5) { logger.warn("ROLLED BACK — nobody gets paid"); break; }

    await sleep(config.STATUS_POLL_INTERVAL);
  }
}

main().catch(e => { logger.error(String(e)); process.exit(1); });
