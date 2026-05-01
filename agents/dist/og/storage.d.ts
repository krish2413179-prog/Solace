import { ethers } from "ethers";
export interface TaskRecord {
    agentWallet: string;
    pipelineId: string;
    jobType: string;
    outputHash: string;
    bountyEth: string;
    onTime: boolean;
    timestamp: number;
    pipelineType: string;
}
export declare function persistTaskRecord(wallet: ethers.Wallet | ethers.HDNodeWallet, record: TaskRecord): Promise<string>;
export declare function getAgentHistory(agentWallet: string): Promise<TaskRecord[]>;
export declare function updateAgentReputation(wallet: ethers.Wallet, agentAddress: string, completed: number, failed: number, totalValue: string): Promise<void>;
