import { ethers } from "ethers";

export function hashOutput(output: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(output));
}

export function bytes32FromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return ethers.getBytes("0x" + clean.padStart(64, "0"));
}
