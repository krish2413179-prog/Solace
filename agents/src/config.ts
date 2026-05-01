import "dotenv/config";

function require(key: string): string {
  const val = process.env[key]?.trim();
  if (!val) throw new Error(`Required env var not set: ${key}`);
  return val;
}

function optional(key: string, fallback = ""): string {
  return process.env[key]?.trim() ?? fallback;
}

export const config = {
  RPC_URL:          require("RPC_URL"),
  SOLACE_ADDRESS:   require("SOLACE_ADDRESS"),
  REGISTRY_ADDRESS: require("REGISTRY_ADDRESS"),

  KEYSTORE_PATH:    optional("KEYSTORE_PATH",     "./keystores/agent.json"),
  KEYSTORE_PASSWORD: optional("KEYSTORE_PASSWORD", ""),

  AXL_BROKER_URL:      optional("AXL_BROKER_URL",      "http://127.0.0.1:7777"),
  PIPELINE_CHANNEL_ID: optional("PIPELINE_CHANNEL_ID", "0xSOLACE01"),
  AXL_PEER_ID:         optional("AXL_PEER_ID",         "solace-node-1"),

  OG_RPC_URL:      optional("OG_RPC_URL",      "https://evmrpc-testnet.0g.ai"),
  OG_STORAGE_URL:  optional("OG_STORAGE_URL",  "https://indexer-storage-testnet-turbo.0g.ai"),
  OG_KV_URL:       optional("OG_KV_URL",       "http://3.101.147.150:6789"),
  OG_PROVIDER:     optional("OG_PROVIDER",     ""),
  OG_STREAM_ID:    optional("OG_STREAM_ID",    "0x000000000000000000000000000000000000000000000000000000000000f2bd"),

  PIPELINE_DURATION:    parseInt(optional("PIPELINE_DURATION",    "600")),
  AXL_COMMIT_TIMEOUT:   parseInt(optional("AXL_COMMIT_TIMEOUT",   "120000")),
  AXL_ACTIVE_TIMEOUT:   parseInt(optional("AXL_ACTIVE_TIMEOUT",   "180000")),
  AXL_POLL_INTERVAL:    parseInt(optional("AXL_POLL_INTERVAL",    "2000")),
  STATUS_POLL_INTERVAL: parseInt(optional("STATUS_POLL_INTERVAL", "5000")),
  KEEPER_POLL_INTERVAL: parseInt(optional("KEEPER_POLL_INTERVAL", "15000")),

  GAS_BUFFER:    parseFloat(optional("GAS_BUFFER",    "1.3")),
  TX_RETRIES:    parseInt(optional("TX_RETRIES",      "3")),
  TX_BACKOFF:    parseInt(optional("TX_BACKOFF",      "2000")),
  LOG_LEVEL:     optional("LOG_LEVEL", "info"),

  PIPELINE_STATUS: {
    0: "NonExistent",
    1: "Pending",
    2: "Active",
    3: "FailedPending",
    4: "Settled",
    5: "RolledBack",
  } as Record<number, string>,

  STEP_STATUS: {
    0: "Pending",
    1: "Runnable",
    2: "Committed",
    3: "Delivered",
    4: "Accepted",
    5: "Disputed",
    6: "Failed",
  } as Record<number, string>,
};
