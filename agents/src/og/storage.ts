import { ethers } from "ethers";
import { Indexer, Batcher, KvClient } from "@0gfoundation/0g-ts-sdk";
import { config } from "../config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("og/storage");

export interface TaskRecord {
  agentWallet:  string;
  pipelineId:   string;
  jobType:      string;
  outputHash:   string;
  bountyEth:    string;
  onTime:       boolean;
  timestamp:    number;
  pipelineType: string;
}

export async function persistTaskRecord(
  wallet:  ethers.Wallet,
  record:  TaskRecord,
): Promise<string> {
  try {
    const indexer = new Indexer(config.OG_STORAGE_URL);
    const [nodes, err] = await indexer.selectNodes(1);
    if (err) throw new Error(`0G node selection failed: ${err}`);

    const provider      = new ethers.JsonRpcProvider(config.OG_RPC_URL);
    const ogWallet      = wallet.connect(provider);
    const flowContract  = await indexer.getFlowContract(config.OG_RPC_URL, ogWallet);
    const batcher       = new Batcher(1, nodes, flowContract, config.OG_RPC_URL);

    const key   = `agent:${record.agentWallet}:task:${record.pipelineId}`;
    const value = JSON.stringify(record);

    const streamId  = ethers.getBytes(config.OG_STREAM_ID);
    const keyBytes  = new TextEncoder().encode(key);
    const valBytes  = new TextEncoder().encode(value);

    batcher.streamDataBuilder.set(streamId, keyBytes, valBytes);
    const [tx, batchErr] = await batcher.exec();
    if (batchErr) throw new Error(`0G batch error: ${batchErr}`);

    logger.info(`Task record persisted to 0G | key: ${key} | tx: ${tx}`);
    return tx as string;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`0G storage failed (non-fatal): ${msg}`);
    return "";
  }
}

export async function getAgentHistory(agentWallet: string): Promise<TaskRecord[]> {
  try {
    const kvClient = new KvClient(config.OG_KV_URL);
    const streamId = ethers.encodeBase64(ethers.getBytes(config.OG_STREAM_ID));

    const prefix    = `agent:${agentWallet}:task:`;
    const keyBytes  = new TextEncoder().encode(prefix);
    const keyB64    = ethers.encodeBase64(keyBytes);

    const value = await kvClient.getValue(streamId, keyB64);
    if (!value) return [];

    const decoded = new TextDecoder().decode(ethers.decodeBase64(value as string));
    return JSON.parse(decoded) as TaskRecord[];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`0G KV read failed: ${msg}`);
    return [];
  }
}

export async function updateAgentReputation(
  wallet:  ethers.Wallet,
  agentAddress: string,
  completed:    number,
  failed:       number,
  totalValue:   string,
): Promise<void> {
  try {
    const indexer = new Indexer(config.OG_STORAGE_URL);
    const [nodes, err] = await indexer.selectNodes(1);
    if (err) throw new Error(`0G node selection: ${err}`);

    const provider  = new ethers.JsonRpcProvider(config.OG_RPC_URL);
    const ogWallet  = wallet.connect(provider);
    const flowContract = await indexer.getFlowContract(config.OG_RPC_URL, ogWallet);
    const batcher   = new Batcher(1, nodes, flowContract, config.OG_RPC_URL);

    const key   = `agent:${agentAddress}:reputation`;
    const value = JSON.stringify({
      completed,
      failed,
      totalValue,
      score:     completed + failed === 0 ? 100 : Math.round((completed * 100) / (completed + failed)),
      updatedAt: Date.now(),
    });

    const streamId = ethers.getBytes(config.OG_STREAM_ID);
    batcher.streamDataBuilder.set(streamId, new TextEncoder().encode(key), new TextEncoder().encode(value));

    const [, batchErr] = await batcher.exec();
    if (batchErr) throw new Error(`0G batch: ${batchErr}`);

    logger.info(`Reputation updated on 0G for ${agentAddress.slice(0, 10)}...`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`0G reputation update failed: ${msg}`);
  }
}
