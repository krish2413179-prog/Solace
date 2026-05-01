import solc from "solc";
import { readFileSync, writeFileSync } from "fs";
import { ethers } from "ethers";
import { config } from "./config.js";
import { getWallet, getProvider } from "./utils/chain.js";

async function compileAndDeploy(name: string, filePath: string, args: any[] = []): Promise<string> {
  const source = readFileSync(filePath, "utf8");
  
  const input = {
    language: "Solidity",
    sources: { [name]: { content: source } },
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } }
    }
  };
  
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  if (output.errors) {
    const errors = output.errors.filter((e: any) => e.severity === 'error');
    if (errors.length > 0) {
      console.error(errors);
      throw new Error(`Compilation failed for ${name}`);
    }
  }
  
  const contract = output.contracts[name][name];
  const bytecode = contract.evm.bytecode.object;
  const abi = contract.abi;
  
  const provider = getProvider();
  const wallet = await getWallet(provider);
  
  console.log(`Deploying ${name} from ${wallet.address}...`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  const address = await deployed.getAddress();
  
  console.log(`${name} deployed to: ${address}`);
  return address;
}

async function main() {
  const provider = getProvider();
  const wallet = await getWallet(provider);
  console.log(`Deployer: ${wallet.address}`);
  
  const registryAddr = await compileAndDeploy("AgentRegistry", "../../contracts/AgentRegistry.sol");
  
  const solaceAddr = await compileAndDeploy("Solace", "../../contracts/Solace.sol", [
    registryAddr,
    wallet.address, 
    wallet.address
  ]);

  const envPath = ".env";
  let env = readFileSync(envPath, "utf8");
  env = env.replace(/REGISTRY_ADDRESS=.*/g, `REGISTRY_ADDRESS=${registryAddr}`);
  env = env.replace(/SOLACE_ADDRESS=.*/g, `SOLACE_ADDRESS=${solaceAddr}`);
  writeFileSync(envPath, env);
  
  console.log("\n.env updated with new contract addresses!");
  
  const appPath = "../App.jsx";
  if (readFileSync(appPath, "utf8").includes("SOLACE_ADDRESS")) {
      let app = readFileSync(appPath, "utf8");
      app = app.replace(/const SOLACE_ADDRESS = ".*";/, `const SOLACE_ADDRESS = "${solaceAddr}";`);
      app = app.replace(/const REGISTRY_ADDRESS = ".*";/, `const REGISTRY_ADDRESS = "${registryAddr}";`);
      writeFileSync(appPath, app);
      console.log("App.jsx updated with new contract addresses!");
  }
}

main().catch(console.error);
