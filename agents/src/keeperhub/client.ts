import { getLogger } from "../utils/logger.js";

const logger  = getLogger("keeperhub");
const KH_BASE = "https://api.keeperhub.com/api";

interface KeeperHubWorkflow { id: string; name: string; status: string; }

interface PipelineWatchers {
  rollbackWorkflowId:         string;
  autoAcceptWorkflowIds:      string[];
  failurePropagationId:       string;
  childSettledNotificationId: string;
}

async function apiRequest(apiKey: string, method: string, path: string, body?: unknown): Promise<unknown> {
  try {
    const resp = await fetch(`${KH_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`KeeperHub ${method} ${path} → ${resp.status}: ${text}`);
    }
    return resp.json();
  } catch (e: any) {
    logger.error(`Fetch failed for ${method} ${path}: ${e.message}`);
    if (e.cause) logger.error(`Cause: ${e.cause}`);
    throw e;
  }
}



async function createAndActivate(apiKey: string, def: unknown): Promise<string> {
  const wf = (await apiRequest(apiKey, "POST", "/v1/workflows", def)) as KeeperHubWorkflow;
  await apiRequest(apiKey, "POST", `/v1/workflows/${wf.id}/go-live`);
  return wf.id;
}

function rollbackWorkflow(
  pipelineId:   string,
  deadlineUnix: number,
  solaceAddress: string,
  chainId:      number,
) {
  return {
    name: `Solace Rollback | ${pipelineId.slice(0, 16)}`,
    description: `SLA enforcement — rolls back pipeline after deadline`,
    trigger: { type: "schedule", config: { cron: "*/1 * * * *" } },
    nodes: [
      {
        id: "check_status",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineStatus",
          args: [pipelineId],
          abi: [{
            name: "getPipelineStatus", type: "function", stateMutability: "view",
            inputs: [{ name: "id", type: "bytes32" }],
            outputs: [{ name: "", type: "uint8" }],
          }],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_status"],
        config: {
          code: `
            const status = Number(inputs.check_status);
            const now    = Math.floor(Date.now() / 1000);
            const isExpired   = now > ${deadlineUnix};
            const isUnsettled = [1, 2, 3].includes(status);
            return { shouldRollback: isExpired && isUnsettled, status, now };
          `,
        },
      },
      {
        id: "rollback",
        type: "web3",
        dependsOn: ["evaluate"],
        condition: "{{evaluate.shouldRollback}} === true",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "rollback",
          args: [pipelineId],
          abi: [{
            name: "rollback", type: "function", stateMutability: "nonpayable",
            inputs: [{ name: "id", type: "bytes32" }], outputs: [],
          }],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

function autoAcceptWorkflow(
  pipelineId:    string,
  stepIndex:     number,
  disputeBlocks: number,
  solaceAddress: string,
  chainId:       number,
) {
  return {
    name: `Solace AutoAccept | ${pipelineId.slice(0, 16)} | step ${stepIndex}`,
    description: `Auto-accepts step ${stepIndex} after dispute window if uncontested`,
    trigger: { type: "schedule", config: { cron: "*/1 * * * *" } },
    nodes: [
      {
        id: "check_step",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getStep",
          args: [pipelineId, stepIndex],
          abi: [{
            name: "getStep", type: "function", stateMutability: "view",
            inputs: [{ name: "id", type: "bytes32" }, { name: "i", type: "uint256" }],
            outputs: [
              { name: "agent",               type: "address" },
              { name: "payout",              type: "uint256" },
              { name: "commitHash",          type: "bytes32" },
              { name: "childPipelineId",     type: "bytes32" },
              { name: "status",              type: "uint8"   },
              { name: "disputeBlock",        type: "uint256" },
              { name: "replacementDeadline", type: "uint256" },
            ],
          }],
        },
      },
      {
        id: "check_block",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineStatus",
          args: [pipelineId],
          abi: [{
            name: "getPipelineStatus", type: "function", stateMutability: "view",
            inputs: [{ name: "id", type: "bytes32" }],
            outputs: [{ name: "", type: "uint8" }],
          }],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_step", "check_block"],
        config: {
          code: `
            const stepStatus  = Number(inputs.check_step[4]);
            const disputeBlock = Number(inputs.check_step[5]);
            const pipeStatus  = Number(inputs.check_block);
            const isDelivered  = stepStatus === 3;
            const isActive     = pipeStatus === 2;
            return { canAutoAccept: isDelivered && isActive, stepStatus, disputeBlock };
          `,
        },
      },
      {
        id: "auto_accept",
        type: "web3",
        dependsOn: ["evaluate"],
        condition: "{{evaluate.canAutoAccept}} === true",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "autoAccept",
          args: [pipelineId, stepIndex],
          abi: [{
            name: "autoAccept", type: "function", stateMutability: "nonpayable",
            inputs: [{ name: "id", type: "bytes32" }, { name: "stepIndex", type: "uint256" }],
            outputs: [],
          }],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

function failurePropagationWorkflow(
  childPipelineId:    string,
  parentPipelineId:   string,
  parentStepIndex:    number,
  solaceAddress:      string,
  chainId:            number,
) {
  return {
    name: `Solace FailProp | child:${childPipelineId.slice(0, 12)}`,
    description: `Propagates failure from child pipeline to parent step ${parentStepIndex}`,
    trigger: { type: "schedule", config: { cron: "*/1 * * * *" } },
    nodes: [
      {
        id: "check_child",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineStatus",
          args: [childPipelineId],
          abi: [{
            name: "getPipelineStatus", type: "function", stateMutability: "view",
            inputs: [{ name: "id", type: "bytes32" }],
            outputs: [{ name: "", type: "uint8" }],
          }],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_child"],
        config: {
          code: `
            const status = Number(inputs.check_child);
            return { shouldPropagate: status === 5 };
          `,
        },
      },
      {
        id: "propagate",
        type: "web3",
        dependsOn: ["evaluate"],
        condition: "{{evaluate.shouldPropagate}} === true",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "propagateFailure",
          args: [parentPipelineId, parentStepIndex, childPipelineId],
          abi: [{
            name: "propagateFailure", type: "function", stateMutability: "nonpayable",
            inputs: [
              { name: "parentId",    type: "bytes32" },
              { name: "stepIndex",   type: "uint256" },
              { name: "childId",     type: "bytes32" },
            ],
            outputs: [],
          }],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

function childSettledWorkflow(
  childPipelineId:  string,
  parentPipelineId: string,
  parentStepIndex:  number,
  solaceAddress:    string,
  chainId:          number,
) {
  return {
    name: `Solace ChildSettled | child:${childPipelineId.slice(0, 12)}`,
    description: `Notifies parent pipeline when child pipeline step ${parentStepIndex} settles`,
    trigger: { type: "schedule", config: { cron: "*/1 * * * *" } },
    nodes: [
      {
        id: "check_child",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineStatus",
          args: [childPipelineId],
          abi: [{
            name: "getPipelineStatus", type: "function", stateMutability: "view",
            inputs: [{ name: "id", type: "bytes32" }],
            outputs: [{ name: "", type: "uint8" }],
          }],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_child"],
        config: {
          code: `
            const status = Number(inputs.check_child);
            return { shouldNotify: status === 4 };
          `,
        },
      },
      {
        id: "notify",
        type: "web3",
        dependsOn: ["evaluate"],
        condition: "{{evaluate.shouldNotify}} === true",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "notifyChildSettled",
          args: [parentPipelineId, parentStepIndex, childPipelineId],
          abi: [{
            name: "notifyChildSettled", type: "function", stateMutability: "nonpayable",
            inputs: [
              { name: "parentId",   type: "bytes32" },
              { name: "stepIndex",  type: "uint256" },
              { name: "childId",    type: "bytes32" },
            ],
            outputs: [],
          }],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

export async function registerPipelineWatcher(
  pipelineId:       string,
  deadlineUnix:     number,
  stepCount:        number,
  solaceAddress:    string,
  chainId:          number,
  parentPipelineId?: string,
  parentStepIndex?:  number,
): Promise<PipelineWatchers> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    logger.warn("KEEPERHUB_API_KEY not set — watchers skipped");
    return { rollbackWorkflowId: "", autoAcceptWorkflowIds: [], failurePropagationId: "", childSettledNotificationId: "" };
  }

  const results: PipelineWatchers = {
    rollbackWorkflowId:         "",
    autoAcceptWorkflowIds:      [],
    failurePropagationId:       "",
    childSettledNotificationId: "",
  };

  try {
    results.rollbackWorkflowId = await createAndActivate(
      apiKey,
      rollbackWorkflow(pipelineId, deadlineUnix, solaceAddress, chainId),
    );
    logger.info(`KeeperHub rollback watcher LIVE | ${pipelineId.slice(0, 16)}...`);

    for (let i = 0; i < stepCount; i++) {
      const id = await createAndActivate(
        apiKey,
        autoAcceptWorkflow(pipelineId, i, 48, solaceAddress, chainId),
      );
      results.autoAcceptWorkflowIds.push(id);
      logger.info(`KeeperHub autoAccept watcher LIVE | step ${i} | ${pipelineId.slice(0, 16)}...`);
    }

    if (parentPipelineId && parentStepIndex !== undefined) {
      results.failurePropagationId = await createAndActivate(
        apiKey,
        failurePropagationWorkflow(pipelineId, parentPipelineId, parentStepIndex, solaceAddress, chainId),
      );
      logger.info(`KeeperHub failure propagation LIVE | child:${pipelineId.slice(0, 12)} → parent step ${parentStepIndex}`);

      results.childSettledNotificationId = await createAndActivate(
        apiKey,
        childSettledWorkflow(pipelineId, parentPipelineId, parentStepIndex, solaceAddress, chainId),
      );
      logger.info(`KeeperHub child-settled notifier LIVE | child:${pipelineId.slice(0, 12)}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`KeeperHub registration failed (non-fatal): ${msg}`);
  }

  return results;
}

export async function cancelWatchers(watchers: PipelineWatchers): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) return;

  const ids: string[] = [
    watchers.rollbackWorkflowId,
    ...watchers.autoAcceptWorkflowIds,
    watchers.failurePropagationId,
    watchers.childSettledNotificationId,
  ].filter(Boolean);

  for (const id of ids) {
    try {
      await apiRequest(apiKey, "POST", `/v1/workflows/${id}/pause`);
      logger.info(`KeeperHub watcher paused: ${id}`);
    } catch (e: unknown) {
      logger.warn(`KeeperHub pause failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function sendSponsoredTransaction(
  contractAddress: string,
  functionName: string,
  functionArgs: any[],
  abi: any,
  value: string = "0"
): Promise<string> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required for sponsorship");
  }

  const KH_API_BASE = "https://api.keeperhub.com/api";

  logger.info(`Requesting Direct Execution for ${functionName} on ${contractAddress}...`);

  const body = {
    contractAddress,
    network: "0g-newton",
    functionName,
    functionArgs: JSON.stringify(functionArgs),
    abi: JSON.stringify(abi),
    value,
    gasLimitMultiplier: "1.5"
  };

  const result = (await apiRequest(apiKey, "POST", "/execute/contract-call", body)) as { executionId: string, status: string, transactionHash?: string };

  if (result.status === "failed") {
    throw new Error(`Execution failed: ${JSON.stringify(result)}`);
  }

  logger.info(`Execution initiated! ID: ${result.executionId}`);
  return result.transactionHash || result.executionId;
}


