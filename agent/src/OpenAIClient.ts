import OpenAI from 'openai';
import { LLMClient, LLMResponse } from './types';

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async generate(prompt: string): Promise<LLMResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'gpt-5.1',
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) throw new Error('No content received from OpenAI');

      return JSON.parse(content) as LLMResponse;
    } catch (error) {
      console.error('LLM Error:', error);
      // Fallback response to prevent crash
      return {
        thought: "Error calling LLM. Stopping.",
        action: { type: 'KEY_PRESS', key: '' }, // No-op
        done: true,
        success: false
      };
    }
  }
}
