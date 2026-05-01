import { ethers } from "ethers";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, getSolace, sendTx, getPipeline, sleep } from "./utils/chain.js";

const logger = getLogger("keeper");

async function watch(pipelineId: string): Promise<void> {
  const provider = getProvider();
  const wallet   = getWallet(provider);
  const solace   = getSolace(wallet);

  logger.info(`KeeperHub watcher started`);
  logger.info(`  Pipeline : ${pipelineId.slice(0, 16)}...`);
  logger.info(`  Caller   : ${wallet.address}`);
  logger.info(`  Poll     : ${config.KEEPER_POLL_INTERVAL}ms`);

  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) throw new Error("Keeper wallet has 0 ETH");

  let errors = 0;

  while (true) {
    try {
      const p        = await getPipeline(solace, pipelineId);
      const now      = Math.floor(Date.now() / 1000);
      const timeLeft = p.deadline - now;

      logger.info(
        `Status: ${p.statusName} | ` +
        `Delivered: ${p.delivered}/${p.total} | ` +
        `Deadline: ${timeLeft <= 0 ? "PASSED" : `in ${timeLeft}s`}`
      );

      errors = 0;

      if (p.status === 4 || p.status === 5) {
        logger.info(`Terminal state: ${p.statusName}. Watcher exiting.`);
        break;
      }

      if (p.status === 2) {
        const currentBlock = await provider.getBlockNumber();
        const SAFETY_BUFFER = 1500;
        for (let i = 0; i < p.total; i++) {
          try {
            const step = await solace.getStep(pipelineId, i);
            const stepStatus   = Number(step[4]);
            const disputeBlock = Number(step[5]);
            if (stepStatus === 3 && disputeBlock > 0 && currentBlock > disputeBlock + SAFETY_BUFFER) {
              logger.info(`autoAccept step ${i} (block ${currentBlock} > disputeBlock ${disputeBlock + SAFETY_BUFFER})`);
              await sendTx(() => solace.autoAccept(pipelineId, i), `autoAccept(${i})`);
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`autoAccept step ${i} skipped: ${msg}`);
          }
        }
      }

      if (now > p.deadline && [1, 2, 3].includes(p.status)) {
        logger.warn("Deadline passed — firing rollback()...");
        try {
          const receipt = await sendTx(
            () => solace.rollback(pipelineId),
            "rollback",
          );
          logger.info(`Rollback executed | TX: ${receipt.hash}`);
          break;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("reverted")) {
            logger.warn(`Rollback reverted (may have settled concurrently): ${msg}`);
            const fresh = await getPipeline(solace, pipelineId);
            if (fresh.status === 4 || fresh.status === 5) break;
          } else {
            throw e;
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`Keeper error: ${msg}`);
      errors++;
      if (errors >= 10) throw new Error("Too many consecutive errors. Aborting.");
      await sleep(Math.min(config.KEEPER_POLL_INTERVAL * Math.pow(2, errors), 120_000));
      continue;
    }

    await sleep(config.KEEPER_POLL_INTERVAL);
  }

  logger.info("KeeperHub watcher stopped.");
}

const pipelineId = process.argv[2];
if (!pipelineId || !pipelineId.startsWith("0x") || pipelineId.length !== 66) {
  console.error("Usage: npm run keeper <0x-pipeline-id>");
  process.exit(1);
}

watch(pipelineId).catch(e => { logger.error(String(e)); process.exit(1); });
