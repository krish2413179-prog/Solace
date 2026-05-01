import { ethers } from "ethers";
import { loadKeystore, getAddressFromKeystore } from "./utils/wallet.js";
import { config } from "./config.js";

async function drain() {
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  
  const worker1Keystore = "./keystores/worker1.json";
  const worker1 = await loadKeystore(worker1Keystore, config.KEYSTORE_PASSWORD || "");
  const worker1Wallet = worker1.connect(provider);
  
  const orchAddr = getAddressFromKeystore(config.KEYSTORE_PATH);
  
  const balance = await provider.getBalance(worker1Wallet.address);
  console.log(`Worker 1 Balance: ${ethers.formatEther(balance)}`);
  
  if (balance > ethers.parseEther("0.1")) {
    const amount = ethers.parseEther("0.4");
    console.log(`Transferring 0.4 A0GI to Orchestrator (${orchAddr})...`);
    
    const tx = await worker1Wallet.sendTransaction({
      to: orchAddr,
      value: amount
    });
    
    await tx.wait();
    console.log(`Transferred! TX: ${tx.hash}`);
  } else {
    console.log("Worker 1 does not have enough balance.");
  }
}

drain().catch(console.error);
