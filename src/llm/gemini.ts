import type { LlmConfig } from '../config.js';
import { request } from '../http.js';
import type { PromptResult } from './prompt.js';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function resolveCustomHeaders(custom?: Record<string, string>): Record<string, string> {
  if (!custom) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(custom)) {
    out[name] = value.replace(ENV_VAR_RE, (_, varName: string) => {
      const v = process.env[varName];
      if (v === undefined || v === '') {
        throw new Error(`llm.custom_headers.${name}: env var ${varName} is not set`);
      }
      return v;
    });
  }
  return out;
}

export async function summarize(prompt: PromptResult, cfg: LlmConfig): Promise<string> {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt.userPrompt }] }],
    systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...resolveCustomHeaders(cfg.custom_headers),
  };

  const res = await request<GeminiResponse>(cfg.endpoint, {
    method: 'POST',
    headers,
    body,
    timeoutMs: 60_000,
  });

  if (res.promptFeedback?.blockReason) {
    const detail = JSON.stringify(res.promptFeedback);
    throw new Error(`Gemini blocked the prompt: ${res.promptFeedback.blockReason} (Details: ${detail})`);
  }

  const candidate = res.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  
  if (!text.trim()) {
    const reason = candidate?.finishReason ? ` (Finish Reason: ${candidate.finishReason})` : '';
    throw new Error(`Gemini returned an empty response${reason}. Full response: ${JSON.stringify(res)}`);
  }

  // If we have text but it was cut off, we still return it but maybe add a hint
  if (candidate?.finishReason === 'MAX_TOKENS' || candidate?.finishReason === 'OTHER') {
    return text.trim() + '\n\n_(Warnung: Zusammenfassung wurde aufgrund von Längenbeschränkungen abgeschnitten)_';
  }

  return text.trim();
}
