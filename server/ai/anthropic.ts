/**
 * Real AI, using the Anthropic API. The API key comes only from the
 * ANTHROPIC_API_KEY environment variable — never from the code.
 *
 * Every request uses the standard (non-beta) Messages API with structured
 * JSON output. If the main model fails or is slow, the request is retried
 * once on the faster fallback model, and every failure is logged with the
 * exact error so problems show up in the server log.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CONFIG, type Difficulty } from '../../shared/config.js';
import { clueContainsAnswer } from '../../shared/rules.js';
import { alternativeClueSystem, escapeClue, quickCheckSystem, reviewSystem } from './prompts.js';
import type { ClueAI, QuickCheckResult, ReviewItem, ReviewVerdict } from './types.js';

const QuickCheck = z.object({ valid: z.boolean(), reason: z.string() });
const Review = z.object({
  results: z.array(z.object({ id: z.string(), flagged: z.boolean(), explanation: z.string(), replacement: z.string() })),
});
const AltClue = z.object({ clue: z.string() });

interface Attempt {
  model: string;
  /** Max time for this attempt (ms); the overall signal still applies. */
  ms?: number;
}

/** Describes an API error precisely for the log (status, type, message). */
function describe(e: unknown): string {
  if (e instanceof Anthropic.APIError) return `${e.status ?? ''} ${e.name}: ${e.message}`.trim();
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

export class AnthropicClueAI implements ClueAI {
  readonly mode = 'anthropic' as const;
  private client = new Anthropic({ maxRetries: 0 });

  /** Runs a structured-output request, trying each model in turn until one succeeds. */
  private async ask<T extends z.ZodType>(
    label: string,
    schema: T,
    system: string,
    user: string,
    attempts: Attempt[],
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<z.infer<T>> {
    let lastError: unknown;
    for (const attempt of attempts) {
      if (signal.aborted) break;
      const attemptSignal = attempt.ms ? AbortSignal.any([signal, AbortSignal.timeout(attempt.ms)]) : signal;
      const started = Date.now();
      try {
        const res = await this.client.messages.parse(
          {
            model: attempt.model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            output_config: {
              format: zodOutputFormat(schema),
              // Haiku 4.5 doesn't support the effort setting; the others run at low effort for speed.
              ...(attempt.model.startsWith('claude-haiku') ? {} : { effort: 'low' as const }),
            },
          },
          { signal: attemptSignal },
        );
        if (res.stop_reason === 'refusal') throw new Error('the model declined this request');
        if (res.stop_reason === 'max_tokens') throw new Error('the reply was cut off (max_tokens)');
        if (!res.parsed_output) throw new Error(`no usable reply (stop_reason ${res.stop_reason})`);
        console.log(`[ai] ${label}: ok with ${attempt.model} in ${Date.now() - started} ms`);
        return res.parsed_output as z.infer<T>;
      } catch (e) {
        lastError = e;
        console.warn(`[ai] ${label}: ${attempt.model} failed after ${Date.now() - started} ms — ${describe(e)}`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
  }

  async quickCheck(answer: string, clue: string, signal: AbortSignal): Promise<QuickCheckResult> {
    return this.ask('live check', QuickCheck, quickCheckSystem(),
      `Answer: ${answer}\n<clue>${escapeClue(clue)}</clue>`,
      [{ model: CONFIG.ai.quickCheckModel }], 300, signal);
  }

  async review(items: ReviewItem[], signal: AbortSignal): Promise<ReviewVerdict[]> {
    if (!items.length) return [];
    const list = items.map((i) => `id=${i.id}  answer=${i.answer}  <clue>${escapeClue(i.clue)}</clue>`).join('\n');
    const out = await this.ask('review', Review, reviewSystem(), `Clues to review:\n${list}`,
      [{ model: CONFIG.ai.reviewModel, ms: CONFIG.ai.reviewPrimaryMs }, { model: CONFIG.ai.fallbackModel }], 16000, signal);
    return out.results;
  }

  async alternativeClue(answer: string, avoid: string[], difficulty: Difficulty, signal: AbortSignal): Promise<string> {
    const existing = avoid.filter(Boolean).map((c) => `<clue>${escapeClue(c)}</clue>`).join('\n') || '(none)';
    const base = `Answer: ${answer}\nPuzzle difficulty: ${difficulty}\nClue(s) the solver already has:\n${existing}`;
    const attempts: Attempt[] = [{ model: CONFIG.ai.hintModel, ms: CONFIG.ai.hintPrimaryMs }, { model: CONFIG.ai.fallbackModel }];

    let { clue } = await this.ask('hint', AltClue, alternativeClueSystem(), base, attempts, 4000, signal);
    if (clueContainsAnswer(clue, answer)) {
      // Ask once more (on the fast model), pointing out the mistake.
      console.warn('[ai] hint: reply contained the answer; asking again');
      ({ clue } = await this.ask('hint retry', AltClue, alternativeClueSystem(),
        `${base}\n\nYour previous attempt, <clue>${escapeClue(clue)}</clue>, contained the answer or a form of it. Write a different clue that does not.`,
        [{ model: CONFIG.ai.fallbackModel }], 1000, signal));
    }
    return clue;
  }
}
