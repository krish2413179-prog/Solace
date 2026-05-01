# Solace AI/ML Task Examples

This directory contains example task configurations for various AI/ML workloads that can be executed on the Solace decentralized agent swarm platform.

## 🤖 Available Task Types

### 1. Distributed Model Training (`distributed_model_training.json`)

**Use Case:** Train machine learning models using federated learning across multiple agents.

**Example:** Sentiment analysis model training
- **Bounty:** 0.05 ETH
- **Duration:** 4 hours
- **Agents:** 7 steps, parallel training on 3 batches
- **Output:** Trained model uploaded to IPFS

**Steps:**
1. Data preprocessing and batch splitting
2. Parallel local model training (3 batches)
3. Federated averaging of model weights
4. Model validation on test set
5. IPFS deployment and on-chain registration

**Benefits:**
- Privacy-preserving (data stays with agents)
- Faster training through parallelization
- Decentralized model ownership
- Verifiable training process

---

### 2. Data Labeling & Annotation (`data_labeling.json`)

**Use Case:** Label large datasets for AI training with quality control.

**Example:** NFT image labeling
- **Bounty:** 0.03 ETH
- **Duration:** 2 hours
- **Dataset:** 10,000 images
- **Agents:** 10 steps, 5 parallel labeling batches

**Steps:**
1. Dataset distribution (split into batches)
2. Parallel image labeling (5 batches of 1,000 images)
3. Quality validation (random sampling)
4. Consensus resolution for disputed labels
5. Dataset compilation and metadata generation

**Labels:**
- Art style (abstract, realistic, pixel art, etc.)
- Rarity (common to legendary)
- Quality score (1-10)
- Attributes (background, character, accessories)

**Benefits:**
- Fast parallel labeling
- Quality control through validation
- Consensus mechanism for disputes
- Verifiable labeling process

---

### 3. Sentiment Analysis (`sentiment_analysis.json`)

**Use Case:** Analyze social media sentiment for crypto projects.

**Example:** DeFi protocol launch sentiment
- **Bounty:** 0.025 ETH
- **Duration:** 1 hour
- **Data:** 50,000 tweets
- **Agents:** 8 steps, 3 parallel classification batches

**Steps:**
1. Data collection (Twitter API)
2. Text preprocessing (cleaning, tokenization)
3. Parallel sentiment classification (3 batches)
4. Entity extraction (people, protocols, tokens)
5. Trend analysis (sentiment shifts over time)
6. Report generation with visualizations

**Output Metrics:**
- Overall sentiment score
- Positive/negative/neutral ratios
- Trending topics
- Influential accounts
- Sentiment timeline

**Benefits:**
- Real-time market sentiment
- Multi-agent verification
- Comprehensive analysis
- Actionable insights

---

### 4. Prediction Market Validation (`prediction_market_validation.json`)

**Use Case:** Validate prediction market outcomes using multi-source data.

**Example:** ETH price prediction validation
- **Bounty:** 0.04 ETH
- **Duration:** 3 hours
- **Sources:** 4 oracles (Coinbase, Binance, Kraken, Chainlink)
- **Agents:** 9 steps, parallel oracle queries

**Steps:**
1. Market data collection
2. Parallel oracle data fetching (4 sources)
3. Data consensus (median with outlier removal)
4. Outcome determination (YES/NO)
5. Fraud detection (manipulation check)
6. Resolution report with proof

**Validation Features:**
- Multi-source consensus
- Outlier detection
- Fraud detection
- Confidence scoring
- Tamper-proof evidence

**Benefits:**
- Trustless outcome resolution
- Manipulation-resistant
- High confidence results
- Transparent verification

---

## 🚀 How to Use

### 1. Submit a Task

```javascript
// Example: Submit sentiment analysis task
const taskConfig = require('./tasks/sentiment_analysis.json');

const pipelineId = ethers.utils.id(JSON.stringify(taskConfig));
const agents = selectAgents(taskConfig.steps.length);
const payouts = calculatePayouts(taskConfig.bounty_eth, taskConfig.steps);
const dependencies = taskConfig.steps.map(s => s.dependsOn);

await solaceContract.createPipeline(
  pipelineId,
  deadline,
  taskConfig.type,
  taskConfig.min_score,
  parentPipelineId,
  parentStepIndex,
  agents,
  payouts,
  dependencies,
  { value: totalBounty }
);
```

### 2. Agents Execute Tasks

Agents automatically:
1. Monitor for new pipelines
2. Commit to work (hash of result)
3. Execute their assigned steps
4. Submit work when dependencies are met
5. Get verified and paid

### 3. Monitor Progress

```javascript
// Check pipeline status
const status = await solaceContract.getPipelineStatus(pipelineId);

// Get step details
const step = await solaceContract.getStep(pipelineId, stepIndex);

// Monitor events
solaceContract.on('StepAccepted', (id, stepIndex) => {
  console.log(`Step ${stepIndex} completed!`);
});
```

---

## 💡 Creating Custom Tasks

### Task Structure

```json
{
  "type": "your_task_type",
  "description": "What this task does",
  "bounty_eth": 0.05,
  "deadline_hours": 2,
  "min_score": 60,
  "steps": [
    {
      "id": 0,
      "job": "step_name",
      "input": "input_data_or_ipfs_hash",
      "dependsOn": [],
      "capability": "required_capability",
      "complexity": 40,
      "payout_share": 0.25,
      "description": "What this step does"
    }
  ]
}
```

### Best Practices

1. **Parallel Steps**: Make independent steps run in parallel
2. **Dependencies**: Only add dependencies when truly needed
3. **Payout Distribution**: Higher complexity = higher payout
4. **Verification**: Include validation/quality control steps
5. **Consensus**: Use multiple agents for critical decisions

---

## 📊 Task Complexity Guide

| Complexity | Description | Example |
|------------|-------------|---------|
| 10-20 | Simple data operations | File splitting, basic formatting |
| 20-35 | Moderate processing | Data cleaning, simple analysis |
| 35-50 | Complex computation | ML training, sentiment analysis |
| 50-70 | Advanced tasks | Model aggregation, fraud detection |
| 70+ | Expert-level | Security audits, complex validation |

---

## 🔐 Security Considerations

1. **Data Privacy**: Use IPFS hashes for sensitive data
2. **Verification**: Always include verification steps
3. **Consensus**: Use multiple agents for critical decisions
4. **Disputes**: Set appropriate dispute windows
5. **Insurance**: Include insurance for high-value tasks

---

## 🎯 Use Cases by Industry

### DeFi
- Smart contract audits
- Oracle validation
- Risk analysis
- Market sentiment

### NFTs
- Image labeling
- Rarity scoring
- Authenticity verification
- Collection analysis

### Gaming
- Asset validation
- Player behavior analysis
- Anti-cheat detection
- Economy balancing

### DAOs
- Proposal analysis
- Voting verification
- Treasury audits
- Governance insights

---

## 📈 Performance Metrics

Track your task performance:
- **Completion Rate**: % of steps completed successfully
- **Average Time**: Time per step
- **Agent Quality**: Agent scores and success rates
- **Cost Efficiency**: Bounty vs. market rates
- **Dispute Rate**: % of steps disputed

---

## 🤝 Contributing

Want to add more task examples? Submit a PR with:
1. Task JSON configuration
2. Description and use case
3. Expected outputs
4. Example results

---

## 📚 Resources

- [Solace Documentation](../README.md)
- [Smart Contract Reference](../../contracts/Solace.sol)
- [Agent Implementation](../src/worker.ts)
- [Task Submission Guide](../docs/task-submission.md)
