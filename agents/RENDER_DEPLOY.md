# Render Deployment — Single Web Service

One command deploys everything: **Broker + Orchestrator + 10 Workers**.

## Architecture

```
solace-swarm (Render Web Service)
├── AXL Broker        (port 7777, internal)
├── Orchestrator      (reads orchestrator keystore)
├── Worker 1          (reads worker1 keystore)
├── Worker 2
├── ...
└── Worker 10
```

Health endpoint: `GET /health` → `{ status: "ok", workers: 10, uptime: ... }`

---

## Step 1: Generate env vars

```bash
cd agents
npm run gen:render-env
# → creates render_env.txt (gitignored)
```

---

## Step 2: Deploy via Blueprint

1. Go to **render.com → New → Blueprint**
2. Connect your GitHub repo
3. Render detects `agents/render.yaml` → creates **`solace-swarm`** web service

---

## Step 3: Set secret env vars in Render dashboard

Go to `solace-swarm` → **Environment** → add these from `render_env.txt`:

| Key | Value |
|-----|-------|
| `ORCH_KEYSTORE_B64` | from render_env.txt |
| `WORKER_1_KEYSTORE_B64` | from render_env.txt |
| `WORKER_2_KEYSTORE_B64` | from render_env.txt |
| ... | ... |
| `WORKER_10_KEYSTORE_B64` | from render_env.txt |
| `KEYSTORE_PASSWORD` | `password123` |
| `OG_COMPUTE_PRIVATE_KEY` | your key |

Everything else is already set in `render.yaml`.

---

## Step 4: Deploy

Click **Deploy** — that's it. Startup sequence:
1. `t=0s` — Broker starts on port 7777
2. `t=3s` — Orchestrator starts
3. `t=5s` — Workers 1-10 start (staggered 1.5s apart)

---

## Local test

```bash
cd agents
npm run swarm
```
