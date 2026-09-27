/**
 * Real AI, using the Anthropic API. The API key comes only from the
 * ANTHROPIC_API_KEY environment variable — never from the code.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CONFIG, type Difficulty } from '../../shared/config.js';
import { alternativeClueSystem, escapeClue, quickCheckSystem, reviewSystem } from './prompts.js';
import type { ClueAI, QuickCheckResult, ReviewItem, ReviewVerdict } from './types.js';

const QuickCheck = z.object({ valid: z.boolean(), reason: z.string() });
const Review = z.object({
  results: z.array(z.object({ id: z.string(), flagged: z.boolean(), explanation: z.string(), replacement: z.string() })),
});
const AltClue = z.object({ clue: z.string() });

/**
 * Opus-tier requests opt into server-side fallbacks: if a safety classifier
 * declines the request, the API re-runs it on a recommended fallback model
 * instead of returning a refusal.
 */
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

export class AnthropicClueAI implements ClueAI {
  readonly mode = 'anthropic' as const;
  private client = new Anthropic({ maxRetries: 0 });

  async quickCheck(answer: string, clue: string, signal: AbortSignal): Promise<QuickCheckResult> {
    const res = await this.client.messages.parse(
      {
        model: CONFIG.ai.quickCheckModel,
        max_tokens: 200,
        system: quickCheckSystem(),
        messages: [{ role: 'user', content: `Answer: ${answer}\n<clue>${escapeClue(clue)}</clue>` }],
        output_config: { format: zodOutputFormat(QuickCheck) },
      },
      { signal },
    );
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`quick check: no result (${res.stop_reason})`);
    return res.parsed_output;
  }

  async review(items: ReviewItem[], signal: AbortSignal): Promise<ReviewVerdict[]> {
    if (!items.length) return [];
    const list = items.map((i) => `id=${i.id}  answer=${i.answer}  <clue>${escapeClue(i.clue)}</clue>`).join('\n');
    const res = await this.client.beta.messages.parse(
      {
        model: CONFIG.ai.reviewModel,
        max_tokens: 16000,
        ...FALLBACK,
        system: reviewSystem(),
        messages: [{ role: 'user', content: `Clues to review:\n${list}` }],
        output_config: { effort: 'low', format: betaZodOutputFormat(Review) },
      },
      { signal },
    );
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`review: no result (${res.stop_reason})`);
    return res.parsed_output.results;
  }

  async alternativeClue(answer: string, avoid: string[], difficulty: Difficulty, signal: AbortSignal): Promise<string> {
    const existing = avoid.filter(Boolean).map((c) => `<clue>${escapeClue(c)}</clue>`).join('\n') || '(none)';
    const res = await this.client.beta.messages.parse(
      {
        model: CONFIG.ai.hintModel,
        max_tokens: 4000,
        ...FALLBACK,
        system: alternativeClueSystem(),
        messages: [{ role: 'user', content: `Answer: ${answer}\nPuzzle difficulty: ${difficulty}\nClue(s) the solver already has:\n${existing}` }],
        output_config: { effort: 'low', format: betaZodOutputFormat(AltClue) },
      },
      { signal },
    );
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`alt clue: no result (${res.stop_reason})`);
    return res.parsed_output.clue;
  }
}
