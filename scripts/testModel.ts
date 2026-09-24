import 'dotenv/config';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';

async function main() {
  console.log('Testing OpenAI model initialization...');

  try {
    const model = buildOpenAIModel();
    console.log('✅ Model created successfully');

    console.log('Testing simple invocation...');
    const response = await model.invoke('Say hello in 5 words or less');
    console.log('✅ Model responded:', response.content);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
