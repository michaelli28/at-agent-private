import { ChatOpenAI } from '@langchain/openai';

export function buildOpenAIModel(modelName: string = 'gpt-5-mini', apiKey?: string) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is required');

  return new ChatOpenAI({
    apiKey: key,
    model: modelName,
  });
}
