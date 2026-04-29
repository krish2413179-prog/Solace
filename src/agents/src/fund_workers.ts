import { ethers } from "ethers";
import { loadKeystore, getAddressFromKeystore } from "./utils/wallet.js";
import { config } from "./config.js";
import { existsSync } from "fs";

const AMOUNT = "0.02";

const recipients: string[] = [];

for (let i = 3; i <= 8; i++) {
  const path = `./keystores/worker${i}.json`;
  if (existsSync(path)) {
    const addr = getAddressFromKeystore(path);
    recipients.push(addr);
    console.log(`  worker${i} → ${addr}`);
  }
}

if (recipients.length === 0) {
  console.error("No worker keystores found (worker3-worker8).");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const sender = await loadKeystore(config.KEYSTORE_PATH, config.KEYSTORE_PASSWORD || undefined);
const wallet = sender.connect(provider);

const balance = await provider.getBalance(wallet.address);
console.log(`\nSender : ${wallet.address}`);
console.log(`Balance: ${ethers.formatEther(balance)} A0GI`);

const totalNeeded = parseFloat(AMOUNT) * recipients.length;
if (parseFloat(ethers.formatEther(balance)) < totalNeeded) {
  console.error(`Insufficient balance. Need ${totalNeeded} A0GI, have ${ethers.formatEther(balance)}`);
  process.exit(1);
}

console.log(`\nSending ${AMOUNT} A0GI to ${recipients.length} workers...\n`);

for (const to of recipients) {
  const tx = await wallet.sendTransaction({
    to,
    value: ethers.parseEther(AMOUNT),
  });
  console.log(`  → ${to} | TX: ${tx.hash}`);
  await tx.wait();
  console.log(`    ✓ confirmed`);
}

console.log(`\nAll workers funded! Run their wallets now to register.\n`);
