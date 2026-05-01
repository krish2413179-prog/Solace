import { ethers } from "ethers";
export declare function getAvailableJobs(): string[];
export declare function execute(wallet: ethers.Wallet | ethers.HDNodeWallet, jobType: string, input: string, params?: Record<string, unknown>): Promise<string>;
