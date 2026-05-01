import { AXLClient } from './axl/client.js';
import { config } from './config.js';

const CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? config.PIPELINE_CHANNEL_ID;

async function broadcastPipeline(pipelineId: string) {
  console.log(`\n📡 Broadcasting pipeline activation: ${pipelineId}\n`);

  const axl = new AXLClient(CHANNEL, 'orchestrator');

  console.log(`✅ Connected to broker: ${config.AXL_BROKER_URL}`);
  console.log(`📢 Channel: ${CHANNEL}\n`);

  try {
    await axl.publish('PIPELINE_ACTIVE', {
      pipeline_id: pipelineId,
      timestamp: Date.now() / 1000
    });

    console.log(`✅ PIPELINE_ACTIVE message published!`);
    console.log(`🎯 Agents should now discover and execute the pipeline\n`);

  } catch (error: any) {
    console.error('❌ Error broadcasting:', error.message);
    process.exit(1);
  }
}

const pipelineId = process.argv[2];

if (!pipelineId) {
  console.log('Usage: npm run broadcast <pipeline_id>');
  console.log('\nExample: npm run broadcast 0x80f78788957891e05681e290337fd79e4c37474d97beb976b9b7cd134290ff08');
  process.exit(1);
}

broadcastPipeline(pipelineId).catch(console.error);
