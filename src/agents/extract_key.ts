import { ethers } from "ethers";
import { readFileSync } from "fs";

const json     = readFileSync("./keystores/orchestrator.json", "utf8");
const wallet   = await ethers.Wallet.fromEncryptedJson(json, "your_password");
console.log("Private key:", wallet.privateKey);