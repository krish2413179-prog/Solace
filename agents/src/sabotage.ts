import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
import { getProvider, getWallet, sleep } from "./utils/chain.js";
import { hashOutput } from "./utils/hash.js";
import { AXLClient } from "./axl/client.js";

const logger  = getLogger("sabotage");
const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;

interface TaskPayload {
  agents: string[];
}

async function main() {
  const provider = getProvider();
  const wallet   = getWallet(provider);
  const axl      = new AXLClient(CHANNEL, wallet.address);

  logger.info(`[SABOTAGE] Wallet  : ${wallet.address}`);
  logger.info(`[SABOTAGE] Channel : ${CHANNEL.slice(0, 16)}...`);
  logger.info(`[SABOTAGE] Will commit then go silent — triggers KeeperHub rollback`);

  while (true) {
    const msgs = await axl.poll("TASK_REGISTRATION", 0);
    for (const msg of msgs) {
      const payload = msg.payload as unknown as TaskPayload;
      const agents  = payload.agents?.map(a => a.toLowerCase()) ?? [];
      if (!agents.includes(wallet.address.toLowerCase())) continue;

      logger.info(`[SABOTAGE] Task received. Sending fake commitment...`);

      await axl.publish("COMMIT", {
        wallet:      wallet.address.toLowerCase(),
        commit_hash: hashOutput("i_will_not_deliver_this_output"),
        timestamp:   Date.now() / 1000,
      });

      logger.info(`[SABOTAGE] Commitment sent. Going silent now.`);
      logger.info(`[SABOTAGE] KeeperHub will fire rollback() when deadline passes.`);

      while (true) {
        await sleep(15_000);
        logger.info(`[SABOTAGE] Still silent...`);
      }
    }
    await sleep(2_000);
  }
}

main().catch(e => { logger.error(String(e)); process.exit(1); });
