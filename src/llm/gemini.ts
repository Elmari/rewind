import type { LlmConfig } from '../config.js';
import { request } from '../http.js';
import type { PromptResult } from './prompt.js';

export function resolveEndpoint(cfg: LlmConfig): string {
  if (!cfg.region) return cfg.endpoint;
  return cfg.endpoint.replace(/\{region\}/g, cfg.region);
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export async function summarize(prompt: PromptResult, cfg: LlmConfig, apiKey: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt.userPrompt }] }],
    systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    accept: 'application/json',
    ...cfg.custom_headers,
  };

  const res = await request<GeminiResponse>(resolveEndpoint(cfg), {
    method: 'POST',
    headers,
    body,
    timeoutMs: 60_000,
  });

  if (res.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${res.promptFeedback.blockReason}`);
  }

  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Gemini returned empty response');
  return text.trim();
}
