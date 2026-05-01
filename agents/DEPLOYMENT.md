# Deployment Guide

This guide covers deploying the Solace agents to various cloud platforms.

## Prerequisites

All keystores are stored as Base64-encoded environment variables to avoid committing sensitive files to git.

### Generate Environment Variables

Run this locally to generate the environment variables:

```powershell
cd agents
.\generate_railway_env.ps1 > railway_env.txt
```

This creates `railway_env.txt` with all 51 environment variables (1 orchestrator + 50 workers).

---

## Option 1: Render (Recommended - Free)

**Free Tier:** 750 hours/month

### Steps:

1. **Sign up** at [render.com](https://render.com)
2. **Create a new Web Service**
   - Connect your GitHub repository
   - Select the `agents` directory as root
3. **Configure:**
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run decode && npm start`
4. **Add Environment Variables:**
   - Go to Environment tab
   - Copy all variables from `railway_env.txt`
   - Paste them (Render accepts bulk paste)
5. **Deploy!**

---

## Option 2: Fly.io (Good for global deployment)

**Free Tier:** 3 shared VMs, 160GB bandwidth/month

### Steps:

1. **Install Fly CLI:**
   ```bash
   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex
   
   # Mac/Linux
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login:**
   ```bash
   fly auth login
   ```

3. **Deploy:**
   ```bash
   cd agents
   fly launch --no-deploy
   ```

4. **Set Environment Variables:**
   ```bash
   # Set orchestrator keystore
   fly secrets set KEYSTORE_ORCH_B64="<base64_content>"
   
   # Set worker keystores (repeat for all 50)
   fly secrets set KEYSTORE_WORKER1_B64="<base64_content>"
   fly secrets set KEYSTORE_WORKER2_B64="<base64_content>"
   # ... etc
   ```
   
   Or use a script to set all at once:
   ```powershell
   # In PowerShell
   Get-Content railway_env.txt | ForEach-Object {
     if ($_ -match '^([^=]+)=(.+)$') {
       fly secrets set "$($matches[1])=$($matches[2])"
     }
   }
   ```

5. **Deploy:**
   ```bash
   fly deploy
   ```

---

## Option 3: Google Cloud Run (Serverless)

**Free Tier:** 2 million requests/month, 360,000 GB-seconds

### Steps:

1. **Install gcloud CLI:** [Download here](https://cloud.google.com/sdk/docs/install)

2. **Login and setup:**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

3. **Create Dockerfile** (if not exists):
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build
   CMD ["sh", "-c", "npm run decode && npm start"]
   ```

4. **Deploy:**
   ```bash
   cd agents
   gcloud run deploy solace-agents \
     --source . \
     --region us-central1 \
     --allow-unauthenticated
   ```

5. **Set Environment Variables:**
   ```bash
   # Set all variables from railway_env.txt
   gcloud run services update solace-agents \
     --update-env-vars KEYSTORE_ORCH_B64="<base64>" \
     --update-env-vars KEYSTORE_WORKER1_B64="<base64>"
   # ... etc
   ```

---

## Option 4: AWS EC2 Free Tier

**Free Tier:** 750 hours/month for 12 months

### Steps:

1. **Launch EC2 Instance:**
   - t2.micro (free tier eligible)
   - Ubuntu 22.04 LTS
   - Open port 8080 in security group

2. **SSH into instance:**
   ```bash
   ssh -i your-key.pem ubuntu@your-instance-ip
   ```

3. **Setup:**
   ```bash
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   
   # Clone repo
   git clone https://github.com/your-repo/solace.git
   cd solace/agents
   
   # Install dependencies
   npm install
   npm run build
   ```

4. **Set Environment Variables:**
   ```bash
   # Create .env file
   nano .env
   # Paste all variables from railway_env.txt
   ```

5. **Run with PM2:**
   ```bash
   sudo npm install -g pm2
   pm2 start npm --name "solace-agents" -- start
   pm2 startup
   pm2 save
   ```

---

## Option 5: Heroku (Limited Free)

**Note:** Heroku requires credit card for verification, even on free tier.

### Steps:

1. **Install Heroku CLI:** [Download here](https://devcenter.heroku.com/articles/heroku-cli)

2. **Login:**
   ```bash
   heroku login
   ```

3. **Create app:**
   ```bash
   cd agents
   heroku create solace-agents
   ```

4. **Set Environment Variables:**
   ```bash
   # Set all variables from railway_env.txt
   heroku config:set KEYSTORE_ORCH_B64="<base64>"
   heroku config:set KEYSTORE_WORKER1_B64="<base64>"
   # ... etc
   ```

5. **Deploy:**
   ```bash
   git push heroku main
   ```

---

## Monitoring & Logs

### Render:
```bash
# View logs in dashboard or CLI
render logs
```

### Fly.io:
```bash
fly logs
```

### Google Cloud Run:
```bash
gcloud run services logs read solace-agents
```

### AWS EC2:
```bash
pm2 logs solace-agents
```

---

## Cost Comparison

| Platform | Free Tier | Best For |
|----------|-----------|----------|
| **Render** | 750 hrs/mo | Easy setup, similar to Railway |
| **Fly.io** | 3 VMs | Global deployment, more control |
| **Cloud Run** | 2M requests | Serverless, auto-scaling |
| **AWS EC2** | 750 hrs/12mo | Full control, learning AWS |
| **Heroku** | Limited | Quick prototypes (needs CC) |

---

## Recommendation

**Start with Render** - it's the easiest migration from Railway with similar features and generous free tier.
