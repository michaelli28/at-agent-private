"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiClient = void 0;
const generative_ai_1 = require("@google/generative-ai");
class GeminiClient {
    constructor(apiKey, modelName = 'gemini-3.0-pro') {
        const key = apiKey || process.env.GEMINI_API_KEY;
        if (!key)
            throw new Error("GEMINI_API_KEY is required");
        this.genAI = new generative_ai_1.GoogleGenerativeAI(key);
        this.model = this.genAI.getGenerativeModel({ model: modelName });
    }
    async generate(prompt) {
        try {
            const result = await this.model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                }
            });
            const response = result.response;
            const text = response.text();
            if (!text)
                throw new Error('No content received from Gemini');
            return JSON.parse(text);
        }
        catch (error) {
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
exports.GeminiClient = GeminiClient;
