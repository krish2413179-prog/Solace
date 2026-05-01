import { ethers } from "ethers";
import { getAddressFromKeystore } from "./utils/wallet.js";
import { config } from "./config.js";
import { getLogger } from "./utils/logger.js";
const logger = getLogger("fund_orchestrator");
// Fund orchestrator with enough for multiple tasks
const AMOUNT = "0.5"; // 0.5 A0GI should be enough for several AI/ML tasks
const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const masterKey = process.env.MASTER_FUNDING_KEY;
if (!masterKey) {
    console.error("MASTER_FUNDING_KEY not set in .env");
    process.exit(1);
}
const wallet = new ethers.Wallet(masterKey, provider);
const orchestratorAddress = getAddressFromKeystore("./keystores/orchestrator.json");
logger.info(`Master wallet: ${wallet.address}`);
const masterBalance = await provider.getBalance(wallet.address);
logger.info(`Master balance: ${ethers.formatEther(masterBalance)} A0GI`);
logger.info(`\nOrchestrator: ${orchestratorAddress}`);
const orchBalance = await provider.getBalance(orchestratorAddress);
logger.info(`Current balance: ${ethers.formatEther(orchBalance)} A0GI`);
if (parseFloat(ethers.formatEther(masterBalance)) < parseFloat(AMOUNT)) {
    console.error(`\nInsufficient master balance. Need ${AMOUNT} A0GI, have ${ethers.formatEther(masterBalance)}`);
    process.exit(1);
}
logger.info(`\nSending ${AMOUNT} A0GI to orchestrator...`);
try {
    const tx = await wallet.sendTransaction({
        to: orchestratorAddress,
        value: ethers.parseEther(AMOUNT),
    });
    logger.info(`Transaction sent: ${tx.hash}`);
    logger.info(`Waiting for confirmation...`);
    await tx.wait();
    const newBalance = await provider.getBalance(orchestratorAddress);
    logger.info(`\n✅ Orchestrator funded successfully!`);
    logger.info(`New balance: ${ethers.formatEther(newBalance)} A0GI`);
}
catch (e) {
    logger.error(`\n❌ Funding failed: ${e.message}`);
    process.exit(1);
}
//# sourceMappingURL=fund_orchestrator.js.map