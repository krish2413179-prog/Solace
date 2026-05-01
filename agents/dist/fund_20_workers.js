import { ethers } from "ethers";
import { getAddressFromKeystore } from "./utils/wallet.js";
import { config } from "./config.js";
import { existsSync } from "fs";
import { getLogger } from "./utils/logger.js";
const logger = getLogger("fund_20_workers");
const AMOUNT = "0.015"; // 0.015 A0GI per worker for capability additions
const recipients = [];
for (let i = 1; i <= 20; i++) {
    const path = `./keystores/worker${i}.json`;
    if (existsSync(path)) {
        const addr = getAddressFromKeystore(path);
        recipients.push(addr);
    }
}
if (recipients.length === 0) {
    console.error("No worker keystores found.");
    process.exit(1);
}
logger.info(`Found ${recipients.length} workers to fund`);
const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const masterKey = process.env.MASTER_FUNDING_KEY;
if (!masterKey) {
    console.error("MASTER_FUNDING_KEY not set in .env");
    process.exit(1);
}
const wallet = new ethers.Wallet(masterKey, provider);
const balance = await provider.getBalance(wallet.address);
logger.info(`Master wallet: ${wallet.address}`);
logger.info(`Balance: ${ethers.formatEther(balance)} A0GI`);
const totalNeeded = parseFloat(AMOUNT) * recipients.length;
if (parseFloat(ethers.formatEther(balance)) < totalNeeded) {
    console.error(`Insufficient balance. Need ${totalNeeded} A0GI, have ${ethers.formatEther(balance)}`);
    process.exit(1);
}
logger.info(`Sending ${AMOUNT} A0GI to ${recipients.length} workers...`);
let funded = 0;
for (const to of recipients) {
    try {
        const currentBalance = await provider.getBalance(to);
        if (parseFloat(ethers.formatEther(currentBalance)) >= 0.012) {
            logger.info(`  ✓ ${to.slice(0, 10)}... already has ${ethers.formatEther(currentBalance)} A0GI (skipping)`);
            continue;
        }
        const tx = await wallet.sendTransaction({
            to,
            value: ethers.parseEther(AMOUNT),
        });
        await tx.wait();
        funded++;
        logger.info(`  ✓ ${to.slice(0, 10)}... funded | TX: ${tx.hash.slice(0, 16)}...`);
    }
    catch (e) {
        logger.warn(`  ✗ ${to.slice(0, 10)}... failed: ${e.message}`);
    }
}
logger.info(`\nFunding complete! ${funded} workers funded.`);
//# sourceMappingURL=fund_20_workers.js.map