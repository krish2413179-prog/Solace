import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { getLogger } from "./logger.js";

const logger = getLogger("utils/wallet");

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.setRawMode?.(true);
    let input = "";
    process.stdin.on("data", (char: Buffer) => {
      const c = char.toString();
      if (c === "\n" || c === "\r") {
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (c === "\u0003") {
        process.exit();
      } else if (c === "\u007f") {
        if (input.length > 0) input = input.slice(0, -1);
      } else {
        input += c;
        process.stdout.write("*");
      }
    });
    process.stdin.resume();
  });
}

export async function loadOrCreateKeystore(
  keystorePath: string,
  password?:    string,
): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  if (existsSync(keystorePath)) {
    return loadKeystore(keystorePath, password);
  }
  logger.warn(`Keystore not found at ${keystorePath}. Creating new one.`);
  return createKeystore(keystorePath, password);
}

export async function loadKeystore(
  keystorePath: string,
  password?:    string,
): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  if (!existsSync(keystorePath)) {
    throw new Error(`Keystore not found: ${keystorePath}`);
  }
  const json    = readFileSync(keystorePath, "utf8");
  const pwd     = password || await prompt(`Unlock keystore [${keystorePath}]: `);
  const wallet  = await ethers.Wallet.fromEncryptedJson(json, pwd);
  logger.info(`Keystore unlocked: ${wallet.address}`);
  return wallet;
}

export async function createKeystore(
  keystorePath: string,
  password?:    string,
): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  const wallet  = ethers.Wallet.createRandom();
  const pwd     = password || await prompt(`Set password for new keystore [${keystorePath}]: `);
  const json    = await wallet.encrypt(pwd);

  const dir = keystorePath.substring(0, keystorePath.lastIndexOf("/"));
  if (dir) mkdirSync(dir, { recursive: true });

  writeFileSync(keystorePath, json);
  logger.info(`Keystore created: ${keystorePath} | Address: ${wallet.address}`);
  return wallet;
}

export function getAddressFromKeystore(keystorePath: string): string {
  if (!existsSync(keystorePath)) throw new Error(`Keystore not found: ${keystorePath}`);
  const data = JSON.parse(readFileSync(keystorePath, "utf8"));
  return "0x" + data.address;
}
