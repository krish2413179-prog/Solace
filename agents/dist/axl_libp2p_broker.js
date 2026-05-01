import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@libp2p/noise";
import { yamux } from "@libp2p/yamux";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { identify } from "@libp2p/identify";
import { ping } from "@libp2p/ping";
import { kadDHT } from "@libp2p/kad-dht";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
const PORT = parseInt(process.env.AXL_PORT ?? "7777");
const TOPIC = "solace-agents";
let node;
const messageStore = new Map();
const MSG_TTL_MS = 3_600_000;
function prune() {
    const cutoff = Date.now() - MSG_TTL_MS;
    for (const [key, msgs] of messageStore.entries()) {
        messageStore.set(key, msgs.filter((m) => m.timestamp * 1000 > cutoff));
    }
}
async function startNode() {
    // @ts-ignore - Type incompatibility between libp2p versions
    node = await createLibp2p({
        addresses: {
            listen: [`/ip4/0.0.0.0/tcp/${PORT}`],
        },
        transports: [tcp()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
            identify: identify(),
            ping: ping(),
            pubsub: gossipsub({
                allowPublishToZeroTopicPeers: true,
                emitSelf: true,
            }),
            dht: kadDHT({
                clientMode: false,
            }),
        },
    });
    await node.start();
    const peerId = node.peerId.toString();
    const addrs = node.getMultiaddrs().map((ma) => ma.toString());
    console.log(`\n🚀 Solace AXL Libp2p Node Started`);
    console.log(`Peer ID: ${peerId}`);
    console.log(`Listening on:`);
    addrs.forEach((addr) => console.log(`  ${addr}`));
    console.log(`\nTopic: ${TOPIC}`);
    console.log(`HTTP API: http://localhost:${PORT + 1000}\n`);
    node.services.pubsub.subscribe(TOPIC);
    node.services.pubsub.addEventListener("message", (evt) => {
        if (evt.detail.topic !== TOPIC)
            return;
        try {
            const msgStr = uint8ArrayToString(evt.detail.data);
            const msg = JSON.parse(msgStr);
            const key = `${msg.msg_type}`;
            if (!messageStore.has(key))
                messageStore.set(key, []);
            messageStore.get(key).push(msg);
            console.log(`[${new Date().toISOString().slice(11, 19)}] RECEIVED ${msg.msg_type} from ${msg.sender.slice(0, 10)}...`);
        }
        catch (err) {
            console.error("Failed to parse message:", err);
        }
    });
    setInterval(prune, 60_000);
}
async function publishMessage(msg) {
    const msgStr = JSON.stringify(msg);
    const msgBytes = uint8ArrayFromString(msgStr);
    await node.services.pubsub.publish(TOPIC, msgBytes);
    console.log(`[${new Date().toISOString().slice(11, 19)}] PUBLISHED ${msg.msg_type} (${msg.sender.slice(0, 10)}...)`);
}
function getMessages(msgType, after = 0) {
    prune();
    const allMsgs = [];
    for (const [key, msgs] of messageStore.entries()) {
        if (!msgType || key === msgType) {
            allMsgs.push(...msgs.filter((m) => m.timestamp > after));
        }
    }
    return allMsgs.sort((a, b) => a.timestamp - b.timestamp);
}
import http from "http";
const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }
    const url = new URL(req.url ?? "/", `http://localhost:${PORT + 1000}`);
    if (req.method === "GET" && url.pathname === "/health") {
        const peerCount = node.getPeers().length;
        const msgCount = Array.from(messageStore.values()).reduce((a, b) => a + b.length, 0);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            peerId: node.peerId.toString(),
            peers: peerCount,
            messages: msgCount,
            transport: "libp2p-gossipsub",
        }));
        return;
    }
    if (req.method === "POST" && url.pathname === "/publish") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const parsed = JSON.parse(body);
                const msg = {
                    sender: parsed.sender?.trim().toLowerCase() ?? "unknown",
                    msg_type: parsed.msg_type?.trim().toUpperCase() ?? "UNKNOWN",
                    payload: parsed.payload ?? {},
                    timestamp: parsed.timestamp ?? Date.now() / 1000,
                };
                await publishMessage(msg);
                res.writeHead(201, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "published" }));
            }
            catch (err) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    if (req.method === "GET" && url.pathname === "/messages") {
        const msgType = url.searchParams.get("msg_type")?.toUpperCase();
        const after = parseFloat(url.searchParams.get("after") ?? "0");
        const msgs = getMessages(msgType, after);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ count: msgs.length, messages: msgs }));
        return;
    }
    if (req.method === "GET" && url.pathname === "/peers") {
        const peers = node.getPeers().map((p) => p.toString());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ peers }));
        return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});
startNode()
    .then(() => {
    httpServer.listen(PORT + 1000, () => {
        console.log(`HTTP API bridge listening on port ${PORT + 1000}`);
    });
})
    .catch((err) => {
    console.error("Failed to start node:", err);
    process.exit(1);
});
//# sourceMappingURL=axl_libp2p_broker.js.map