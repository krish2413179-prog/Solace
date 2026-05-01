export interface AXLMessage {
    sender: string;
    msg_type: string;
    payload: Record<string, unknown>;
    timestamp: number;
}
export declare class AXLClient {
    private readonly http;
    private readonly channelId;
    private readonly sender;
    private isLibp2p;
    constructor(channelId: string, sender: string);
    private checkBroker;
    publish(msgType: string, payload: Record<string, unknown>): Promise<void>;
    poll(msgType?: string, after?: number): Promise<AXLMessage[]>;
    waitFor(msgType: string, minCount: number, after?: number, timeout?: number): Promise<AXLMessage[]>;
    waitForTask(myAddr: string): Promise<any>;
}
