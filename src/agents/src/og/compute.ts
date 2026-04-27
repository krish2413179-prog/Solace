import { ethers } from "ethers";
import { createZGServingNetworkBroker } from "@0glabs/0g-serving-broker";
import { config } from "../config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("og/compute");

interface InferenceResult {
  output:   string;
  verified: boolean;
  provider: string;
}

let _broker: Awaited<ReturnType<typeof createZGServingNetworkBroker>> | null = null;
let _providerMeta: { endpoint: string; model: string } | null = null;

async function getBroker(wallet: ethers.Wallet) {
  if (_broker) return _broker;
  const ogProvider = new ethers.JsonRpcProvider(config.OG_RPC_URL);
  const ogWallet   = wallet.connect(ogProvider);
  _broker          = await createZGServingNetworkBroker(ogWallet);
  logger.info("0G Serving broker initialized");
  return _broker;
}

async function getProviderMeta(broker: Awaited<ReturnType<typeof createZGServingNetworkBroker>>) {
  if (_providerMeta) return _providerMeta;
  if (!config.OG_PROVIDER) throw new Error("OG_PROVIDER not set in .env");

  await broker.inference.acknowledgeProviderSigner(config.OG_PROVIDER);
  const { endpoint, model } = await broker.inference.getServiceMetadata(config.OG_PROVIDER);
  _providerMeta = { endpoint, model };
  logger.info(`0G provider: ${endpoint} | model: ${model}`);
  return _providerMeta;
}

export async function callOGCompute(
  wallet:       ethers.Wallet,
  systemPrompt: string,
  userPrompt:   string,
): Promise<InferenceResult> {
  const broker = await getBroker(wallet);
  const meta   = await getProviderMeta(broker);

  const headers = await broker.inference.getRequestHeaders(
    config.OG_PROVIDER,
    userPrompt,
  );

  const body = {
    model:    meta.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
    max_tokens: 1500,
  };

  const resp = await fetch(`${meta.endpoint}/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`0G inference HTTP ${resp.status}: ${text}`);
  }

  const data     = await resp.json() as { choices: { message: { content: string } }[]; id: string };
  const chatID   = resp.headers.get("ZG-Res-Key") ?? data.id;
  const verified = await broker.inference.processResponse(config.OG_PROVIDER, chatID);
  const output   = data.choices[0].message.content;

  logger.info(`0G inference complete | verified: ${verified} | ${output.length} chars`);
  return { output, verified, provider: config.OG_PROVIDER };
}
