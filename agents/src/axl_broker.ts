import http from "http";

const PORT       = parseInt(process.env.AXL_PORT ?? "7777");
const MSG_TTL_MS = 3_600_000;

interface Message {
    sender:    string;
    msg_type:  string;
    payload:   Record<string, unknown>;
    timestamp: number;
}

const channels = new Map<string, Message[]>();

function prune(channelId: string) {
    const cutoff = Date.now() - MSG_TTL_MS;
    const msgs   = channels.get(channelId) ?? [];
    channels.set(channelId, msgs.filter(m => m.timestamp > cutoff / 1000));
}

function ensure(channelId: string) {
    if (!channels.has(channelId)) channels.set(channelId, []);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
    const json = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => (data += chunk));
        req.on("end",  () => resolve(data));
        req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin",  "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url    = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const parts  = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
        const total = Array.from(channels.values()).reduce((a, b) => a + b.length, 0);
        return send(res, 200, { status: "ok", channels: channels.size, messages: total });
    }

    if (req.method === "GET" && url.pathname === "/channels") {
        const list = Array.from(channels.entries()).map(([id, msgs]) => ({ id, message_count: msgs.length }));
        return send(res, 200, { channels: list });
    }

    if (parts[0] === "channel" && parts[1]) {
        const channelId = parts[1];

        if (req.method === "POST" && parts[2] === "publish") {
            const body = await readBody(req);
            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: "Invalid JSON" }); }

            const sender   = (parsed.sender as string)?.trim().toLowerCase();
            const msg_type = (parsed.msg_type as string)?.trim().toUpperCase();
            if (!sender || !msg_type) return send(res, 400, { error: "sender and msg_type required" });

            ensure(channelId);
            prune(channelId);

            const msg: Message = {
                sender,
                msg_type,
                payload:   (parsed.payload as Record<string, unknown>) ?? {},
                timestamp: (parsed.timestamp as number) ?? Date.now() / 1000,
            };

            channels.get(channelId)!.push(msg);
            console.log(`[${new Date().toISOString().slice(11,19)}] PUBLISH ${msg_type} → ${channelId.slice(0,12)}... (${sender.slice(0,10)}...)`);
            return send(res, 201, { status: "published", total: channels.get(channelId)!.length });
        }

        if (req.method === "GET" && parts[2] === "messages") {
            ensure(channelId);
            prune(channelId);

            const msgType = url.searchParams.get("msg_type")?.toUpperCase();
            const after   = parseFloat(url.searchParams.get("after") ?? "0");
            const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

            const results = (channels.get(channelId) ?? [])
                .filter(m => m.timestamp > after && (!msgType || m.msg_type === msgType))
                .slice(0, limit);

            return send(res, 200, { channel_id: channelId, count: results.length, messages: results });
        }

        if (req.method === "DELETE" && parts.length === 2) {
            channels.delete(channelId);
            res.writeHead(204); res.end();
            return;
        }
    }

    send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`Solace AXL Broker running on http://0.0.0.0:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
});