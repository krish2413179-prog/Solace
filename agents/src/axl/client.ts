import axios, { AxiosInstance } from "axios";
import { config } from "../config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("axl/client");

export interface AXLMessage {
  sender:    string;
  msg_type:  string;
  payload:   Record<string, unknown>;
  timestamp: number;
}

export class AXLClient {
  private readonly http:      AxiosInstance;
  private readonly channelId: string;
  private readonly sender:    string;
  private isLibp2p:           boolean = false;

  constructor(channelId: string, sender: string) {
    this.channelId = channelId;
    this.sender    = sender.toLowerCase();
    this.http      = axios.create({
      baseURL: config.AXL_BROKER_URL,
      timeout: 10_000,
    });
    this.checkBroker();
  }

  private async checkBroker(): Promise<void> {
    try {
      const resp = await this.http.get("/health");
      this.isLibp2p = resp.data.transport === "libp2p-gossipsub";
      const transport = this.isLibp2p ? "libp2p" : "HTTP REST";
      logger.debug(`AXL broker reachable at ${config.AXL_BROKER_URL} (${transport})`);
    } catch {
      throw new Error(`AXL broker unreachable at ${config.AXL_BROKER_URL}`);
    }
  }

  async publish(msgType: string, payload: Record<string, unknown>): Promise<void> {
    const endpoint = this.isLibp2p ? "/publish" : `/channel/${this.channelId}/publish`;
    await this.http.post(endpoint, {
      sender:    this.sender,
      msg_type:  msgType.toUpperCase(),
      payload,
      timestamp: Date.now() / 1000,
    });
    logger.debug(`AXL published ${msgType} via ${this.isLibp2p ? "libp2p" : "HTTP"}`);
  }

  async poll(msgType?: string, after = 0): Promise<AXLMessage[]> {
    const params: Record<string, unknown> = { after: after / 1000, limit: 100 };
    if (msgType) params.msg_type = msgType.toUpperCase();
    const endpoint = this.isLibp2p ? "/messages" : `/channel/${this.channelId}/messages`;
    const resp = await this.http.get(endpoint, { params });
    return resp.data.messages as AXLMessage[];
  }

  async waitFor(
    msgType:  string,
    minCount: number,
    after     = 0,
    timeout   = 120_000,
  ): Promise<AXLMessage[]> {
    const deadline = Date.now() + timeout;
    logger.info(`Waiting for ${minCount}x '${msgType}' on ${this.channelId.slice(0, 16)}...`);

    while (Date.now() < deadline) {
      const msgs = await this.poll(msgType, after);
      if (msgs.length >= minCount) {
        logger.info(`Received ${msgs.length} '${msgType}' message(s)`);
        return msgs;
      }
      await new Promise(r => setTimeout(r, config.AXL_POLL_INTERVAL));
    }
    throw new Error(`Timeout waiting for ${minCount}x '${msgType}' after ${timeout}ms`);
  }

  async waitForTask(myAddr: string): Promise<any> {
    const myLower = myAddr.toLowerCase();
    while (true) {
      const msgs = await this.poll("TASK_ASSIGNMENT");
      for (const m of msgs) {
        const p = m.payload as any;
        if (p.target_agent) {
          if (p.target_agent.toLowerCase() === myLower) return p;
        } 
        else if (p.agents && Array.isArray(p.agents)) {
          if (p.agents.map((a: string) => a.toLowerCase()).includes(myLower)) return p;
        }
      }
      await new Promise(r => setTimeout(r, config.AXL_POLL_INTERVAL));
    }
  }
}
