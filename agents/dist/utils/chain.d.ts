import { ethers, ContractTransactionReceipt } from "ethers";
export declare function getProvider(): ethers.JsonRpcProvider;
export declare function getWallet(provider: ethers.JsonRpcProvider): Promise<ethers.Wallet | ethers.HDNodeWallet>;
export declare function getSolace(wallet: ethers.Wallet | ethers.HDNodeWallet): ethers.Contract;
export declare function getRegistry(wallet: ethers.Wallet | ethers.HDNodeWallet): ethers.Contract;
export declare function sendTx(fn: () => Promise<ethers.ContractTransactionResponse>, label: string, retries?: number): Promise<ContractTransactionReceipt>;
export declare function getPipeline(solace: ethers.Contract, pipelineId: string): Promise<{
    orchestrator: string;
    deadline: number;
    bounty: bigint;
    delivered: number;
    total: number;
    status: number;
    statusName: string;
    accepted: number;
    pipelineType: string;
}>;
export declare function sleep(ms: number): Promise<void>;
export declare function generatePipelineId(task: object): string;
