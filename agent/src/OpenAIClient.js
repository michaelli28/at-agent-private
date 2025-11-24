"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIClient = void 0;
const openai_1 = __importDefault(require("openai"));
class OpenAIClient {
    constructor(apiKey) {
        this.client = new openai_1.default({
            apiKey: apiKey || process.env.OPENAI_API_KEY,
        });
    }
    async generate(prompt) {
        try {
            const completion = await this.client.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'gpt-5.1',
                response_format: { type: 'json_object' },
            });
            const content = completion.choices[0].message.content;
            if (!content)
                throw new Error('No content received from OpenAI');
            return JSON.parse(content);
        }
        catch (error) {
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
exports.OpenAIClient = OpenAIClient;
