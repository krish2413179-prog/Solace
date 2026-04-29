import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { ogTestnet } from './chain'; // I'll create this or just define it inline

const REGISTRY_ADDRESS = '0x21cB38cA0AC6185C3aC4C17259c04BCE334Dc33c';

const REGISTRY_ABI = [
  {
    "inputs": [
      { "internalType": "string", "name": "peerId", "type": "string" },
      { "internalType": "string[]", "name": "caps", "type": "string[]" }
    ],
    "name": "registerAgent",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

async function run() {
  const pkey = generatePrivateKey();
  const account = privateKeyToAccount(pkey);
  console.log(`Agent: ${account.address}`);
  
  const masterAccount = privateKeyToAccount('0x11836fa6f7f4d8b0401320479157d8c0416b670940074723615bcdffd168a2b1');
  
  const client = createWalletClient({
    account,
    chain: {
        id: 16602,
        name: '0G Galileo',
        nativeCurrency: { name: 'A0GI', symbol: 'A0GI', decimals: 18 },
        rpcUrls: { default: { http: ['https://evmrpc-testnet.0g.ai'] } }
    },
    transport: http()
  });

  const publicClient = createPublicClient({
    chain: {
        id: 16602,
        name: '0G Galileo',
        nativeCurrency: { name: 'A0GI', symbol: 'A0GI', decimals: 18 },
        rpcUrls: { default: { http: ['https://evmrpc-testnet.0g.ai'] } }
    },
    transport: http()
  });

  console.log('Funding...');
  const fundHash = await client.sendTransaction({
    account: masterAccount,
    to: account.address,
    value: parseEther('0.05'),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  console.log('Funded.');

  console.log('Registering via Viem...');
  
  try {
    const hash = await client.writeContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'registerAgent',
        args: ['viem-agent', ['audit', 'review']],
        value: parseEther('0.01'),
        account
    });
    console.log('Hash:', hash);
  } catch (e) {
    console.error(e);
  }
}

run();
