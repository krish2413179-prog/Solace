import { ethers } from "ethers";
import { callOGCompute } from "../og/compute.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("executors");

type Executor = (wallet: ethers.Wallet | ethers.HDNodeWallet, input: string, params: Record<string, unknown>) => Promise<string>;

const REGISTRY: Map<string, Executor> = new Map();

function register(jobType: string, fn: Executor) {
  REGISTRY.set(jobType, fn);
  logger.debug(`Registered executor: ${jobType}`);
}

export function getAvailableJobs(): string[] {
  return Array.from(REGISTRY.keys());
}

export async function execute(
    wallet:  ethers.Wallet | ethers.HDNodeWallet,
    jobType: string,
    input:   string,
    params:  Record<string, unknown> = {},
): Promise<string> {
  const fn = REGISTRY.get(jobType);
  if (!fn) throw new Error(`No executor for '${jobType}'. Available: ${getAvailableJobs().join(", ")}`);
  logger.info(`Executing job via 0G Compute: ${jobType}`);
  const result = await fn(wallet, input, params);
  logger.info(`Job complete: ${jobType} | ${result.length} chars`);
  return result;
}

register("static_analysis", async (_w, input) =>
    (await callOGCompute(
        "You are a Solidity security auditor. Analyze for reentrancy, integer overflow, access control issues, front-running, and other vulnerabilities. Return a structured JSON report with severity levels (Critical/High/Medium/Low) and remediation steps.",
        `Audit this Solidity contract:\n\n${input}`,
    )).output
);

register("business_logic_audit", async (_w, input) =>
    (await callOGCompute(
        "You are a smart contract business logic auditor. Identify economic attack vectors, logic flaws, sandwich attack possibilities, and mismatches between stated intent and implementation. Be precise and actionable.",
        `Analyze this contract for business logic flaws:\n\n${input}`,
    )).output
);

register("gas_optimization", async (_w, input) =>
    (await callOGCompute(
        "You are a Solidity gas optimization expert. Find storage packing opportunities, unnecessary SLOADs, loop inefficiencies, and calldata vs memory optimizations. Estimate gas savings per function.",
        `Optimize gas usage in:\n\n${input}`,
    )).output
);

register("test_coverage_analysis", async (_w, input) =>
    (await callOGCompute(
        "You are a smart contract testing expert. Identify untested code paths, missing edge cases, and generate missing test cases in Foundry format. Include fuzz tests where appropriate.",
        `Generate missing tests for:\n\n${input}`,
    )).output
);

register("tokenomics_analysis", async (_w, input) =>
    (await callOGCompute(
        "You are a tokenomics analyst. Model emission schedules, vesting cliff pressure on price, unlock event impact, inflation rate, and identify rug pull risk vectors with probability estimates.",
        `Analyze tokenomics for:\n\n${input}`,
    )).output
);

register("defi_risk_analysis", async (_w, input) =>
    (await callOGCompute(
        "You are a DeFi risk analyst. Assess liquidity risk, oracle manipulation vectors, liquidation cascade scenarios, flash loan attack surfaces, and protocol dependency risks. Output risk scores per category.",
        `Assess DeFi risk for:\n\n${input}`,
    )).output
);

register("code_review", async (_w, input) =>
    (await callOGCompute(
        "You are a senior software engineer. Review code for security vulnerabilities, architectural issues, performance bottlenecks, missing tests, and documentation gaps. Be specific and prioritized.",
        `Review this code:\n\n${input}`,
    )).output
);

register("liquidity_analysis", async (_w, input) =>
    (await callOGCompute(
        "You are a DeFi liquidity analyst. Analyze LP lock duration and size, model minimum safe exit liquidity, rug pull scenario probabilities, and slippage impact at various exit sizes.",
        `Analyze liquidity for:\n\n${input}`,
    )).output
);