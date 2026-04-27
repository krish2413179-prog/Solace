import { createKeystore } from "./utils/wallet.ts";
import { getLogger } from "./utils/logger.ts";

const logger = getLogger("keygen");

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("Usage: npm run keygen <output_path>");
  console.error("Example: npm run keygen ./keystores/worker1.json");
  process.exit(1);
}

const password = process.env.KEYSTORE_PASSWORD;

const wallet = await createKeystore(outputPath, password);

console.log(`\n  Keystore : ${outputPath}`);
console.log(`  Address  : ${wallet.address}`);
console.log(`\n  Fund this address with ETH for gas.`);
console.log(`  Add to .env:`);
console.log(`    KEYSTORE_PATH=${outputPath}`);
console.log(`    KEYSTORE_PASSWORD=your_password\n`);
