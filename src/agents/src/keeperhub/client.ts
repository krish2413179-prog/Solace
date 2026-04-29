import { getLogger } from "../utils/logger.js";

const logger = getLogger("keeperhub");

const KH_BASE = "https://api.keeperhub.com";

interface KeeperHubWorkflow {
  id: string;
  name: string;
  status: string;
}

interface PipelineWatchers {
  settlementWorkflowId: string;
  rollbackWorkflowId: string;
}

async function apiRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const resp = await fetch(`${KH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `KeeperHub API ${method} ${path} → ${resp.status}: ${text}`,
    );
  }

  return resp.json();
}

async function createAndActivate(
  apiKey: string,
  def: unknown,
): Promise<string> {
  const wf = (await apiRequest(
    apiKey,
    "POST",
    "/v1/workflows",
    def,
  )) as KeeperHubWorkflow;
  await apiRequest(apiKey, "POST", `/v1/workflows/${wf.id}/go-live`);
  return wf.id;
}

function settlementWorkflow(
  pipelineId: string,
  agentCount: number,
  solaceAddress: string,
  chainId: number,
) {
  return {
    name: `Solace Settle | ${pipelineId.slice(0, 16)}`,
    description: `Atomic settlement trigger for Solace pipeline ${pipelineId} — fires when all ${agentCount} agent hashes are on-chain`,
    trigger: {
      type: "schedule",
      config: { cron: "*/1 * * * *" },
    },
    nodes: [
      {
        id: "check_delivered",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineCore",
          args: [pipelineId],
          abi: [
            {
              name: "getPipelineCore",
              type: "function",
              stateMutability: "view",
              inputs: [{ name: "id", type: "bytes32" }],
              outputs: [
                { name: "orch", type: "address" },
                { name: "deadline", type: "uint256" },
                { name: "bounty", type: "uint256" },
                { name: "delivered", type: "uint256" },
                { name: "total", type: "uint256" },
                { name: "status", type: "uint8" },
              ],
            },
          ],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_delivered"],
        config: {
          code: `
            const delivered = Number(inputs.check_delivered[3]);
            const total     = Number(inputs.check_delivered[4]);
            const status    = Number(inputs.check_delivered[5]);
            const allIn     = delivered === total && total > 0;
            const isActive  = status === 2 || status === 3;
            const shouldSettle = allIn && isActive;
            return { shouldSettle, delivered, total, status };
          `,
        },
      },
      {
        id: "settle",
        type: "web3",
        dependsOn: ["evaluate"],
        condition: "{{evaluate.shouldSettle}} === true",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "settle",
          args: [pipelineId],
          abi: [
            {
              name: "settle",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [{ name: "id", type: "bytes32" }],
              outputs: [],
            },
          ],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

function rollbackWorkflow(
  pipelineId: string,
  deadlineUnix: number,
  solaceAddress: string,
  chainId: number,
) {
  return {
    name: `Solace Rollback | ${pipelineId.slice(0, 16)}`,
    description: `SLA enforcement — slashes non-deliverers and refunds orchestrator when block.timestamp > deadline`,
    trigger: {
      type: "schedule",
      config: { cron: "*/1 * * * *" },
    },
    nodes: [
      {
        id: "check_status",
        type: "web3",
        config: {
          chainId,
          contractAddress: solaceAddress,
          functionName: "getPipelineStatus",
          args: [pipelineId],
          abi: [
            {
              name: "getPipelineStatus",
              type: "function",
              stateMutability: "view",
              inputs: [{ name: "id", type: "bytes32" }],
              outputs: [{ name: "", type: "uint8" }],
            },
          ],
        },
      },
      {
        id: "evaluate",
        type: "code",
        dependsOn: ["check_status"],
        config: {
          code: `
            const status       = Number(inputs.check_status);
            const now          = Math.floor(Date.now() / 1000);
            const deadline     = ${deadlineUnix};
            const isExpired    = now > deadline;
            const isUnsettled  = [1, 2, 3].includes(status);
            const shouldRollback = isExpired && isUnsettled;
            return { shouldRollback, status, now, deadline };
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
          abi: [
            {
              name: "rollback",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [{ name: "id", type: "bytes32" }],
              outputs: [],
            },
          ],
        },
      },
    ],
    autoDisableOnSuccess: true,
  };
}

export async function registerPipelineWatcher(
  pipelineId: string,
  deadlineUnix: number,
  agentCount: number,
  solaceAddress: string,
  chainId: number,
): Promise<PipelineWatchers> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    logger.warn(
      "KEEPERHUB_API_KEY not set — KeeperHub settlement & rollback workflows skipped",
    );
    return { settlementWorkflowId: "", rollbackWorkflowId: "" };
  }

  try {
    const settlementId = await createAndActivate(
      apiKey,
      settlementWorkflow(pipelineId, agentCount, solaceAddress, chainId),
    );
    logger.info(
      `KeeperHub settlement watcher LIVE | workflow: ${settlementId} | pipeline: ${pipelineId.slice(0, 16)}...`,
    );

    const rollbackId = await createAndActivate(
      apiKey,
      rollbackWorkflow(pipelineId, deadlineUnix, solaceAddress, chainId),
    );
    logger.info(
      `KeeperHub rollback guard LIVE | workflow: ${rollbackId} | deadline: ${new Date(deadlineUnix * 1000).toISOString()}`,
    );

    return { settlementWorkflowId: settlementId, rollbackWorkflowId: rollbackId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`KeeperHub registration failed (non-fatal): ${msg}`);
    return { settlementWorkflowId: "", rollbackWorkflowId: "" };
  }
}

export async function cancelWatchers(watchers: PipelineWatchers): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) return;

  for (const [label, id] of [
    ["settlement", watchers.settlementWorkflowId],
    ["rollback",   watchers.rollbackWorkflowId],
  ] as [string, string][]) {
    if (!id) continue;
    try {
      await apiRequest(apiKey, "POST", `/v1/workflows/${id}/pause`);
      logger.info(`KeeperHub ${label} watcher paused: ${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`KeeperHub pause (${label}) failed: ${msg}`);
    }
  }
}
