import { ethers } from "ethers";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, getSolace, getRegistry, sendTx, generatePipelineId, sleep } from "./utils/chain.js";
import { hashOutput } from "./utils/hash.js";
import { AXLClient } from "./axl/client.js";
import { execute, getAvailableJobs } from "./executors/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerPipelineWatcher } from "./keeperhub/client.js";
import { persistTaskRecord } from "./og/storage.js";

process.on("uncaughtException", (e) => {
  console.error("UNCAUGHT:", e);
  process.exit(1);
});

const logger  = getLogger("worker");
const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;

const STEP_STATUS = { Pending: 0, Runnable: 1, Committed: 2, Delivered: 3, Accepted: 4, Disputed: 5, Failed: 6 };
const PIPE_STATUS = { NonExistent: 0, Pending: 1, Active: 2, FailedPending: 3, Settled: 4, RolledBack: 5 };

const DELEGATE_COMPLEXITY_THRESHOLD = 60;
const DELEGATE_MIN_PROFIT_MARGIN    = 0.25;
const MIN_AGENT_SCORE               = 65;
const STEP_POLL_INTERVAL            = 3000;

interface StepSpec {
  agent_index:  number;
  job:          string;
  input:        string;
  complexity?:  number;
  dependsOn?:   number[];
  maxSubAgents?: number;
  [key: string]: unknown;
}

interface TaskPayload {
  pipeline_id:  string;
  step_index:   number;
  payout_eth:   number;
  deadline:     number;
  min_score:    number;
  pipeline_type: string;
  task: {
    steps:                  StepSpec[];
    required_capabilities?: string[];
    description:            string;
  };
  agents:      string[];
  payouts_eth: number[];
  timestamp:   number;
}

let aborted = false;

import { sendSponsoredTransaction } from "./keeperhub/client.js";

async function ensureRegistered(registry: ethers.Contract, wallet: ethers.Wallet | ethers.HDNodeWallet): Promise<void> {
  const isReg = await registry.isRegistered(wallet.address) as boolean;
  if (isReg) {
    logger.info("Already registered");
    return;
  }
  
  const caps     = getAvailableJobs();
  const minStake = await registry.MIN_STAKE() as bigint;
  logger.info(`Registering | caps: ${caps.join(", ")}`);

  try {
    await sendTx(
      () => registry.register(caps, { value: minStake }),
      "register",
    );
  } catch (e: any) {
    if (e.message === "SPONSORSHIP_REQUIRED") {
      logger.info("Requesting sponsored registration from KeeperHub...");
      
      const txHash = await sendSponsoredTransaction(
        await registry.getAddress(),
        "register",
        [caps],
        JSON.parse(readFileSync(join(process.cwd(), "registry_abi.json"), "utf8")),
        minStake.toString()
      );
      logger.info(`Sponsored registration submitted: ${txHash}`);
      return;
    }

    throw e;
  }
  logger.info(`Registered | stake: ${ethers.formatEther(minStake)} A0GI`);
}


async function waitForTask(axl: AXLClient, address: string, seenPipelines: Set<string>, startedAfter: number): Promise<TaskPayload> {
  logger.info(`Listening for task on ${CHANNEL.slice(0, 16)}...`);
  while (!aborted) {
    const msgs = await axl.poll("TASK_ASSIGNMENT", 0);
    for (const msg of msgs) {
      if (msg.timestamp < startedAfter / 1000) continue;
      const p = msg.payload as unknown as TaskPayload;
      if (!p?.pipeline_id) continue;
      const taskKey = `${p.pipeline_id}:${p.step_index}`;
      if (seenPipelines.has(taskKey)) continue;
      const targetAgent = (p as any).target_agent as string | undefined;
      const isTargeted = targetAgent
        ? targetAgent.toLowerCase() === address.toLowerCase()
        : p.agents?.map((a: string) => a.toLowerCase()).includes(address.toLowerCase());
      if (isTargeted) {
        logger.info(`Task assigned | step: ${p.step_index} | job: ${p.task.steps[p.step_index]?.job}`);
        seenPipelines.add(taskKey);
        return p;
      }
    }
    await sleep(config.AXL_POLL_INTERVAL);
  }
  throw new Error("Aborted before task received");
}

async function waitForStepRunnable(
  solace:     ethers.Contract,
  pipelineId: string,
  stepIndex:  number,
): Promise<void> {
  logger.info(`Waiting for step ${stepIndex} to become Runnable...`);
  while (!aborted) {
    const [,,,, status] = await solace.getStep(pipelineId, stepIndex);
    const s = Number(status);
    if (s === STEP_STATUS.Runnable)  { logger.info(`Step ${stepIndex} is Runnable`); return; }
    if (s === STEP_STATUS.Failed)    throw new Error(`Step ${stepIndex} was marked Failed`);
    if (s === STEP_STATUS.Accepted)  throw new Error(`Step ${stepIndex} already accepted`);
    const pipeStatus = Number(await solace.getPipelineStatus(pipelineId));
    if (pipeStatus === PIPE_STATUS.RolledBack) throw new Error("Pipeline rolled back");
    if (pipeStatus === PIPE_STATUS.Settled)    throw new Error("Pipeline already settled");
    await sleep(STEP_POLL_INTERVAL);
  }
  throw new Error("Aborted while waiting for step");
}

function listenForAbort(axl: AXLClient): void {
  (async () => {
    while (!aborted) {
      const msgs = await axl.poll("ABORT", 0);
      if (msgs.length > 0) {
        logger.warn("ABORT received — stopping work");
        aborted = true;
        return;
      }
      await sleep(config.AXL_POLL_INTERVAL);
    }
  })();
}

function shouldDelegate(step: StepSpec, payoutEth: number, availableAgents: number): boolean {
  const complexity = step.complexity ?? 50;
  if (complexity < DELEGATE_COMPLEXITY_THRESHOLD) return false;
  if (availableAgents < 2)                        return false;
  const maxSubAgents    = Math.min(step.maxSubAgents ?? 5, availableAgents);
  const estimatedCost   = payoutEth * (1 - DELEGATE_MIN_PROFIT_MARGIN);
  const perAgentPayout  = estimatedCost / maxSubAgents;
  if (perAgentPayout < 0.001)                     return false;
  return true;
}

async function runAsSubOrchestrator(
  solace:      ethers.Contract,
  registry:    ethers.Contract,
  axl:         AXLClient,
  wallet:      ethers.Wallet | ethers.HDNodeWallet,
  parentId:    string,
  stepIndex:   number,
  step:        StepSpec,
  payoutEth:   number,
  deadline:    number,
  minScore:    number,
  pipelineType: string,
): Promise<void> {
  logger.info(`Acting as sub-orchestrator for step ${stepIndex}`);

  const allAvailable  = await registry.getAvailableAgents() as string[];
  const cap           = step.job;
  let candidates: string[] = [];
  try {
    candidates = await registry.getAgentsByCapability(cap) as string[];
  } catch {
    candidates = allAvailable;
  }

  candidates = candidates.filter((a: string) => a.toLowerCase() !== wallet.address.toLowerCase());

  const scored: { addr: string; score: bigint }[] = [];
  for (const addr of candidates) {
    const score = await registry.getScore(addr) as bigint;
    if (score >= BigInt(minScore)) scored.push({ addr, score });
  }
  scored.sort((a, b) => (b.score > a.score ? 1 : -1));

  const maxSubAgents = Math.min(step.maxSubAgents ?? 3, scored.length, 5);
  if (maxSubAgents === 0) throw new Error("No eligible sub-agents found");

  const subAgents    = scored.slice(0, maxSubAgents).map(s => s.addr);
  const costFraction = 1 - DELEGATE_MIN_PROFIT_MARGIN;
  const totalCost    = ethers.parseEther((payoutEth * costFraction).toFixed(18));
  const perAgent     = totalCost / BigInt(maxSubAgents);
  const payoutsWei   = subAgents.map(() => perAgent);
  const childDeadline = deadline - config.PIPELINE_DURATION;

  const childId    = generatePipelineId({ parentId, stepIndex, ts: Date.now() });
  const deps       = subAgents.map(() => [] as number[]);
  const minScoreArr = subAgents.map(() => minScore);

  logger.info(`Creating child pipeline | agents: ${maxSubAgents} | childId: ${childId.slice(0, 16)}...`);

  await sendTx(
    () => solace.createPipeline(
      childId,
      childDeadline,
      pipelineType,
      minScore,
      parentId,
      stepIndex,
      subAgents.map((a: string) => ethers.getAddress(a)),
      payoutsWei,
      deps,
      { value: totalCost },
    ),
    "createChildPipeline",
  );

  await sendTx(
    () => solace.linkChildPipeline(parentId, stepIndex, childId),
    "linkChildPipeline",
  );

  const childSubTask = {
    pipeline_id:   childId,
    parent_id:     parentId,
    parent_step:   stepIndex,
    pipeline_type: pipelineType,
    deadline:      childDeadline,
    min_score:     minScore,
    task: {
      description: step.input,
      steps: subAgents.map((_, i) => ({
        agent_index: i,
        job:         step.job,
        input:       step.input,
        complexity:  Math.floor((step.complexity ?? 50) * 0.6),
      })),
    },
    agents:      subAgents,
    payouts_eth: subAgents.map(() => parseFloat(ethers.formatEther(perAgent))),
    timestamp:   Date.now() / 1000,
  };

  await axl.publish("TASK_ASSIGNMENT", childSubTask);
  logger.info("Sub-agents notified via AXL");

  const commits = await axl.waitFor("COMMIT", maxSubAgents, Date.now(), config.AXL_COMMIT_TIMEOUT);
  const registered = new Set(subAgents.map((a: string) => a.toLowerCase()));
  const commitMap  = new Map<string, string>();

  for (const msg of commits) {
    const w = (msg.payload.wallet as string).toLowerCase();
    if (registered.has(w)) commitMap.set(w, msg.payload.commit_hash as string);
  }

  if (commitMap.size < maxSubAgents) {
    throw new Error(`Missing commits: got ${commitMap.size}/${maxSubAgents}`);
  }

  const orderedHashes = subAgents.map((a: string) =>
    ethers.zeroPadValue(commitMap.get(a.toLowerCase())!, 32)
  );

  await sendTx(
    () => solace.lockCommitments(childId, orderedHashes),
    "lockCommitments(child)",
  );

  await axl.publish("PIPELINE_ACTIVE", { pipeline_id: childId, timestamp: Date.now() / 1000 });
  logger.info("Child pipeline active — monitoring...");

  await registerPipelineWatcher(
    childId,
    childDeadline,
    maxSubAgents,
    config.SOLACE_ADDRESS,
    Number((await solace.runner?.provider?.getNetwork())?.chainId ?? 16600),
    parentId,
    stepIndex,
  );

  while (!aborted) {
    const status = Number(await solace.getPipelineStatus(childId));
    if (status === PIPE_STATUS.Settled) {
      logger.info("Child pipeline settled");
      await sendTx(
        () => solace.notifyChildSettled(parentId, stepIndex, childId),
        "notifyChildSettled",
      );
      return;
    }
    if (status === PIPE_STATUS.RolledBack) {
      throw new Error("Child pipeline rolled back");
    }
    await sleep(config.STATUS_POLL_INTERVAL);
  }

  throw new Error("Aborted while monitoring child pipeline");
}

async function sendCommit(axl: AXLClient, address: string, output: string): Promise<string> {
  const hash = hashOutput(output);
  await axl.publish("COMMIT", {
    wallet:      address.toLowerCase(),
    commit_hash: hash,
    timestamp:   Date.now() / 1000,
  });
  logger.info(`Commitment sent: ${hash.slice(0, 16)}...`);
  return hash;
}

async function waitForPipelineActive(axl: AXLClient, solace: ethers.Contract, startedAt: number): Promise<string> {
  logger.info("Waiting for PIPELINE_ACTIVE...");
  const msgs       = await axl.waitFor("PIPELINE_ACTIVE", 1, startedAt, config.AXL_ACTIVE_TIMEOUT);
  const pipelineId = msgs[0].payload.pipeline_id as string;
  const status     = Number(await solace.getPipelineStatus(pipelineId));
  if (status !== PIPE_STATUS.Active) throw new Error(`Expected Active(2), got ${status}`);
  logger.info(`Pipeline active | ID: ${pipelineId.slice(0, 16)}...`);
  return pipelineId;
}

async function runOnce(
  provider: ethers.JsonRpcProvider,
  wallet:   ethers.Wallet | ethers.HDNodeWallet,
  solace:   ethers.Contract,
  registry: ethers.Contract,
  axl:      AXLClient,
  seenPipelines: Set<string>,
  startedAfter:  number,
): Promise<void> {
  const startedAt   = Date.now();
  const payload     = await waitForTask(axl, wallet.address, seenPipelines, startedAfter);
  const stepIndex   = payload.step_index;
  const step        = payload.task.steps[stepIndex];
  const payoutEth   = payload.payout_eth;
  const deadline    = payload.deadline;
  const minScore    = payload.min_score ?? 0;
  const pipelineType = payload.pipeline_type ?? "general";

  if (!step) throw new Error(`No step at index ${stepIndex}`);

  const pipelineId = payload.pipeline_id;
  if (!pipelineId) throw new Error("No pipeline_id in task payload");

  const allAvailable = (await registry.getAvailableAgents() as string[]).filter(
    (a: string) => a.toLowerCase() !== wallet.address.toLowerCase()
  );

  let outputHash: string;

  if (shouldDelegate(step, payoutEth, allAvailable.length)) {
    logger.info(`Delegating step ${stepIndex} to sub-agents`);
    outputHash = hashOutput(`delegated:${pipelineId}:${stepIndex}`);
    await sendCommit(axl, wallet.address, outputHash);

    await waitForPipelineActive(axl, solace, startedAt);
    await waitForStepRunnable(solace, pipelineId, stepIndex);

    if (aborted) throw new Error("Aborted after step became runnable");

    await runAsSubOrchestrator(
      solace, registry, axl, wallet,
      pipelineId, stepIndex, step,
      payoutEth, deadline, minScore, pipelineType,
    );
  } else {
    logger.info(`Executing step ${stepIndex} solo | job: ${step.job}`);
    const params = Object.fromEntries(
      Object.entries(step).filter(([k]) => !["job", "input", "agent_index", "complexity", "dependsOn", "maxSubAgents"].includes(k))
    ) as Record<string, unknown>;
    const output = await execute(wallet, step.job, step.input, params);
    outputHash   = await sendCommit(axl, wallet.address, output);

    await persistTaskRecord(wallet, {
      agentWallet:  wallet.address,
      pipelineId,
      jobType:      step.job,
      outputHash,
      bountyEth:    String(payoutEth),
      onTime:       true,
      timestamp:    Date.now(),
      pipelineType,
    }).catch(e => logger.warn(`persistTaskRecord failed (non-fatal): ${e.message}`));

    await waitForPipelineActive(axl, solace, startedAt);
    await waitForStepRunnable(solace, pipelineId, stepIndex);

    if (aborted) throw new Error("Aborted after step became runnable");
  }

  if (aborted) throw new Error("Aborted before submitWork");

  logger.info(`Submitting work on-chain | step: ${stepIndex} | hash: ${outputHash.slice(0, 16)}...`);

  try {
    const receipt = await sendTx(
      () => solace.submitWork(pipelineId, stepIndex, outputHash),
      "submitWork",
    );
    logger.info(`Work submitted | TX: ${receipt.hash}`);
  } catch (e: any) {
    if (e.message === "SPONSORSHIP_REQUIRED") {
      logger.info("Requesting sponsored submission from KeeperHub...");
      
      const txHash = await sendSponsoredTransaction(
        await solace.getAddress(),
        "submitWork",
        [pipelineId, stepIndex, outputHash],
        JSON.parse(readFileSync(join(process.cwd(), "abi.json"), "utf8"))
      );
      logger.info(`Sponsored work submitted: ${txHash}`);
    } else {
      throw e;
    }
  }

  while (!aborted) {
    const pipeStatus = Number(await solace.getPipelineStatus(pipelineId));
    const stepData   = await solace.getStep(pipelineId, stepIndex);
    const sStatus    = Number(stepData[4]);
    const disputeBlock = Number(stepData[5]);
    logger.info(`Pipeline: ${config.PIPELINE_STATUS[pipeStatus]} | Step ${stepIndex}: ${sStatus}`);

    if (pipeStatus === PIPE_STATUS.Settled)    { logger.info("SETTLED — payout received"); break; }
    if (pipeStatus === PIPE_STATUS.RolledBack) { logger.warn("ROLLED BACK — no payout");   break; }
    if (sStatus    === STEP_STATUS.Accepted)   { logger.info("Step accepted — awaiting full settlement"); }
    if (sStatus    === STEP_STATUS.Failed)     { logger.warn("Step failed"); break; }

    if (sStatus === STEP_STATUS.Delivered && disputeBlock > 0) {
      try {
        const currentBlock = await provider.getBlockNumber();
        const SAFETY_BUFFER = 1500;
        if (currentBlock > disputeBlock + SAFETY_BUFFER) {
          logger.info(`Calling autoAccept for step ${stepIndex} (block ${currentBlock} > ${disputeBlock + SAFETY_BUFFER})...`);
          await sendTx(() => solace.autoAccept(pipelineId, stepIndex), `autoAccept(${stepIndex})`);
        } else {
          logger.debug(`Dispute window open for step ${stepIndex} (block ${currentBlock}/${disputeBlock + SAFETY_BUFFER})`);
        }
      } catch (e: any) {
        logger.warn(`autoAccept skipped: ${e.message}`);
      }
    }

    await sleep(config.STATUS_POLL_INTERVAL);
  }
}

async function main() {
  const provider = getProvider();
  const wallet   = await getWallet(provider);
  const solace   = getSolace(wallet);
  const registry = getRegistry(wallet);
  const axl      = new AXLClient(CHANNEL, wallet.address);

  logger.info(`Worker: ${wallet.address}`);

  const staggerDelay = Math.floor(Math.random() * 15000);
  logger.info(`Staggered startup: waiting ${staggerDelay}ms...`);
  await sleep(staggerDelay);

  const balance = await provider.getBalance(wallet.address);
  logger.info(`Balance: ${ethers.formatEther(balance)} A0GI`);

  if (balance === 0n) {
    logger.warn("Worker has 0 balance — running in SPONSORED mode via KeeperHub");
  }

  await ensureRegistered(registry, wallet);
  listenForAbort(axl);

  const seenPipelines = new Set<string>();
  const workerStartedAt = Date.now();

  while (!aborted) {
    try {
      await runOnce(provider, wallet, solace, registry, axl, seenPipelines, workerStartedAt);
      logger.info("Task cycle complete — waiting for next task...");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      if (aborted) break;
      logger.warn(`Task cycle error (will retry): ${msg}`);
      await sleep(5000);
    }
  }

  logger.info("Worker shutting down.");
}

main().catch(e => { logger.error(String(e)); process.exit(1); });
