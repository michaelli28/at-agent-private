import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export function buildGeminiModel(modelName: string = 'gemini-2.5-flash', apiKey?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required');

  return new ChatGoogleGenerativeAI({
    apiKey: key,
    model: modelName,
    thinking_budget: 0,
  });
}
