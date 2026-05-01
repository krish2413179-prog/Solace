import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { getProvider } from './src/utils/chain.js';
import { loadKeystore } from './src/utils/wallet.js';
import { config } from './src/config.js';

const REGISTRY_ABI = JSON.parse(readFileSync('./registry_abi.json', 'utf8'));

async function addCapabilities() {
  const provider = getProvider();
  const registry = new ethers.Contract(config.REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  
  console.log(`Adding AI/ML capabilities to workers...\n`);
  
  const password = 'password123';
  
  // Comprehensive list of ALL capabilities - Smart Contract, AI/ML, Data, Blockchain
  const allCapabilities = [
    // Smart Contract Auditing
    'smart_contract_audit',
    'security_research',
    'code_review',
    'static_analysis',
    'business_logic_audit',
    'gas_optimization',
    'test_coverage_analysis',
    'tokenomics_analysis',
    'defi_risk_analysis',
    'liquidity_analysis',
    
    // AI/ML Capabilities
    'data_processing',
    'ml_training',
    'ml_aggregation',
    'ml_validation',
    'ml_inference',
    'model_deployment',
    'data_scraping',
    'data_collection',
    'nlp_preprocessing',
    'text_preprocessing',
    'sentiment_analysis',
    'sentiment_classification',
    'ner',
    'entity_extraction',
    'data_analysis',
    'trend_analysis',
    'reporting',
    'report_generation',
    'data_distribution',
    'dataset_distribution',
    'image_annotation',
    'image_labeling',
    'quality_control',
    'quality_validation',
    'consensus',
    'consensus_resolution',
    'data_aggregation',
    'dataset_compilation',
    'metadata',
    'metadata_generation',
    
    // Oracle & Data Validation
    'data_collection',
    'oracle_integration',
    'chainlink_oracle',
    'consensus_algorithm',
    'logic_evaluation',
    'anomaly_detection',
    
    // General Purpose
    'computation',
    'verification',
    'validation',
    'aggregation',
    'coordination'
  ];
  
  console.log(`\n📋 Adding ${allCapabilities.length} capabilities to 20 workers...\n`);
  
  for (let i = 1; i <= 20; i++) {
    try {
      const keystorePath = `./keystores/worker${i}.json`;
      const workerWallet = await loadKeystore(keystorePath, password);
      const worker = workerWallet.connect(provider);
      
      console.log(`Worker ${i} (${worker.address})`);
      
      // Add each capability
      for (const cap of allCapabilities) {
        try {
          const tx = await registry.connect(worker).addCapability(cap);
          await tx.wait();
          console.log(`  ✓ Added: ${cap}`);
        } catch (error: any) {
          if (error.message.includes('AlreadyExists')) {
            console.log(`  - Already has: ${cap}`);
          } else {
            console.log(`  ✗ Failed: ${cap} - ${error.message}`);
          }
        }
      }
      console.log();
      
    } catch (error: any) {
      console.error(`Worker ${i} failed:`, error.message);
    }
  }
  
  console.log('\nCapabilities added!');
}

addCapabilities().catch(console.error);
