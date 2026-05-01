import { ethers, ContractTransactionReceipt } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "../config.js";
import { getLogger } from "./logger.js";
import { loadKeystore } from "./wallet.js";

const logger = getLogger("utils/chain");
const __dir  = dirname(fileURLToPath(import.meta.url));

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.RPC_URL);
}

export async function getWallet(provider: ethers.JsonRpcProvider): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  const wallet = await loadKeystore(
    config.KEYSTORE_PATH,
    config.KEYSTORE_PASSWORD || undefined,
  );
  return wallet.connect(provider) as ethers.Wallet | ethers.HDNodeWallet;
}

export function getSolace(wallet: ethers.Wallet | ethers.HDNodeWallet): ethers.Contract {
  const abi = JSON.parse(readFileSync(join(__dir, "../../abi.json"), "utf8"));
  return new ethers.Contract(config.SOLACE_ADDRESS, abi, wallet);
}

export function getRegistry(wallet: ethers.Wallet | ethers.HDNodeWallet): ethers.Contract {
  const abi = JSON.parse(readFileSync(join(__dir, "../../registry_abi.json"), "utf8"));
  return new ethers.Contract(config.REGISTRY_ADDRESS, abi, wallet);
}

import { sendSponsoredTransaction } from "../keeperhub/client.js";

export async function sendTx(
  fn:       () => Promise<ethers.ContractTransactionResponse>,
  label:    string,
  retries = config.TX_RETRIES,
): Promise<ContractTransactionReceipt> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Sending TX: ${label} (attempt ${attempt}/${retries})`);

      const wallet = await getWallet(getProvider());
      const balance = await wallet.provider!.getBalance(wallet.address);

      if (balance === 0n) {
        logger.info(`Wallet empty. Attempting sponsored relay for ${label}...`);
        throw new Error("SPONSORSHIP_REQUIRED");
      }

      const tx      = await fn();
      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) throw new Error(`TX reverted: ${tx.hash}`);
      logger.info(`TX confirmed block ${receipt.blockNumber}: ${receipt.hash}`);
      return receipt;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      
      if (msg === "SPONSORSHIP_REQUIRED") throw e;

      logger.warn(`TX attempt ${attempt} failed: ${msg}`);
      if (attempt === retries) throw e;
      await sleep(config.TX_BACKOFF * Math.pow(2, attempt - 1));
    }
  }
  throw new Error("TX failed after all retries");
}


export async function getPipeline(solace: ethers.Contract, pipelineId: string) {
  const [orch, deadline, bounty, delivered, total, status] =
    await solace.getPipelineCore(pipelineId);
  const [accepted, pType] = await solace.getPipelineMeta(pipelineId);
  return {
    orchestrator: orch as string,
    deadline:     Number(deadline),
    bounty:       bounty as bigint,
    delivered:    Number(delivered),
    total:        Number(total),
    status:       Number(status),
    statusName:   config.PIPELINE_STATUS[Number(status)] ?? "Unknown",
    accepted:     Number(accepted),
    pipelineType: pType as string,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generatePipelineId(task: object): string {
  const entropy = ethers.hexlify(ethers.randomBytes(16));
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(task) + entropy));
}
