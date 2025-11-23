import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMClient, LLMResponse } from './types';

export class GeminiClient implements LLMClient {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey?: string, modelName: string = 'gemini-3.0-pro') {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is required");

    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
  }

  async generate(prompt: string): Promise<LLMResponse> {
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      });

      const response = result.response;
      const text = response.text();

      if (!text) throw new Error('No content received from Gemini');

      return JSON.parse(text) as LLMResponse;
    } catch (error) {
      console.error('Gemini LLM Error:', error);
      return {
        thought: "Error calling Gemini. Stopping.",
        action: { type: 'KEY_PRESS', key: '' },
        done: true,
        success: false
      };
    }
  }
}
