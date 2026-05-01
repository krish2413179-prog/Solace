import { ethers } from "ethers";
import { writeFileSync, mkdirSync, existsSync } from "fs";

import { config } from "./config.js";

const COUNT = parseInt(process.argv[2] ?? "6");
const PASSWORD = config.KEYSTORE_PASSWORD || process.env.KEYSTORE_PASSWORD || "";
const START_INDEX = parseInt(process.argv[3] ?? "3");

const outputDir = "./keystores";
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

console.log(`\nGenerating ${COUNT} wallets starting at worker${START_INDEX}...\n`);

for (let i = 0; i < COUNT; i++) {
  const index = START_INDEX + i;
  const wallet = ethers.Wallet.createRandom();
  const json = await wallet.encrypt(PASSWORD);
  const path = `${outputDir}/worker${index}.json`;
  writeFileSync(path, json);
  console.log(`  worker${index} | ${wallet.address} | ${path}`);
}

console.log(`\nDone. Fund each address with A0GI before running workers.\n`);
