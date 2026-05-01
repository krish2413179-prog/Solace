import { ethers } from "ethers";
export declare function loadOrCreateKeystore(keystorePath: string, password?: string): Promise<ethers.Wallet | ethers.HDNodeWallet>;
export declare function loadKeystore(keystorePath: string, password?: string): Promise<ethers.Wallet | ethers.HDNodeWallet>;
export declare function createKeystore(keystorePath: string, password?: string): Promise<ethers.Wallet | ethers.HDNodeWallet>;
export declare function getAddressFromKeystore(keystorePath: string): string;
