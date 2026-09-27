import { AnthropicClueAI } from './anthropic.js';
import { MockClueAI } from './mock.js';
import type { ClueAI } from './types.js';

/**
 * Uses the real AI when ANTHROPIC_API_KEY is set, otherwise the pretend AI.
 * Set AI_MODE=mock to force the pretend AI even when a key is present.
 */
export function createClueAI(): ClueAI {
  if (process.env.AI_MODE === 'mock' || !process.env.ANTHROPIC_API_KEY) return new MockClueAI();
  return new AnthropicClueAI();
}

export type { ClueAI };
