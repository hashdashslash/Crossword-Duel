/**
 * Real AI, using the Anthropic API. The API key comes only from the
 * ANTHROPIC_API_KEY environment variable — never from the code.
 *
 * Every request uses the standard (non-beta) Messages API. If the main model
 * fails or is slow, the request is retried on the faster fallback model, and
 * every failure is logged with the exact error plus a plain-English reason.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CONFIG, type Difficulty } from '../../shared/config.js';
import { cleanClue, clueContainsAnswer } from '../../shared/rules.js';
import { alternativeClueSystem, escapeClue, quickCheckSystem, reviewSystem } from './prompts.js';
import type { ClueAI, QuickCheckResult, ReviewItem, ReviewVerdict } from './types.js';

const QuickCheck = z.object({ valid: z.boolean(), reason: z.string() });
const Review = z.object({
  results: z.array(z.object({ id: z.string(), flagged: z.boolean(), explanation: z.string(), replacement: z.string() })),
});
const AltClue = z.object({ clue: z.string() });
const Define = z.object({ senses: z.array(z.object({ pos: z.string(), text: z.string() })) });

interface Attempt {
  model: string;
  /** Max time for this attempt (ms); the overall signal still applies. */
  ms?: number;
}

/** An AI failure with a plain-English reason that is safe to show to players. */
export class AIError extends Error {
  constructor(readonly reason: string, readonly fatal: boolean) {
    super(reason);
  }
}

/** Turns any API error into a plain-English reason (never includes the key). */
export function explainAIError(e: unknown, model?: string): AIError {
  if (e instanceof AIError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.AuthenticationError) return new AIError('the API key was rejected (check ANTHROPIC_API_KEY)', true);
  if (e instanceof Anthropic.PermissionDeniedError) return new AIError(`this API key isn't allowed to use ${model ?? 'this model'}`, false);
  if (e instanceof Anthropic.NotFoundError) return new AIError(`the model ${model ?? ''} isn't available to this account`.replace('  ', ' '), false);
  if (e instanceof Anthropic.RateLimitError) return new AIError('too many AI requests right now (rate limit); try again shortly', false);
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(msg)) {
    return new AIError('the Anthropic account is out of credit (add credit under Billing at console.anthropic.com)', true);
  }
  if (e instanceof Anthropic.BadRequestError) return new AIError(`the AI service rejected the request: ${msg.slice(0, 200)}`, false);
  if (e instanceof Anthropic.APIConnectionTimeoutError || (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError' || /abort|timed out/i.test(msg)))) {
    return new AIError('the AI took too long to answer', false);
  }
  if (e instanceof Anthropic.APIConnectionError) return new AIError("couldn't reach the AI service (network problem)", false);
  if (e instanceof Anthropic.InternalServerError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)) {
    return new AIError('the AI service is busy or having problems right now', false);
  }
  return new AIError(msg.slice(0, 200), false);
}

function raw(e: unknown): string {
  if (e instanceof Anthropic.APIError) return `${e.status ?? ''} ${e.message}`.trim();
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * The key as pasted into the host's settings, minus the usual copy-paste
 * accidents: surrounding spaces or quotes, or a leading "ANTHROPIC_API_KEY=".
 */
export function cleanApiKey(value: string | undefined): string {
  let key = (value ?? '').trim();
  key = key.replace(/^ANTHROPIC_API_KEY\s*=\s*/, '');
  key = key.replace(/^(["'])(.*)\1$/, '$2').trim();
  return key;
}

/** A safe description of the key for the log (never the key itself), to compare with the console's key list. */
export function describeApiKey(key: string): string {
  if (!key) return 'empty';
  const shape = key.startsWith('sk-ant-') ? 'starts with sk-ant-' : `does NOT start with sk-ant- (starts with "${key.slice(0, 3)}")`;
  return `${shape}, ends in ...${key.slice(-4)}, ${key.length} characters${/\s/.test(key) ? ', contains spaces' : ''}`;
}

export class AnthropicClueAI implements ClueAI {
  readonly mode = 'anthropic' as const;
  readonly apiKey = cleanApiKey(process.env.ANTHROPIC_API_KEY);
  readonly client = new Anthropic({ apiKey: this.apiKey, maxRetries: 0 });

  /** Runs a structured-output request, trying each model in turn until one succeeds. */
  private async ask<T extends z.ZodType>(
    label: string, schema: T, system: string, user: string, attempts: Attempt[], maxTokens: number, signal: AbortSignal,
  ): Promise<z.infer<T>> {
    let last: AIError = new AIError(`${label} failed`, false);
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
        if (res.stop_reason === 'refusal') throw new AIError('the AI declined this request', false);
        if (res.stop_reason === 'max_tokens') throw new AIError('the AI reply was cut off', false);
        if (!res.parsed_output) throw new AIError(`the AI gave no usable reply (${res.stop_reason})`, false);
        console.log(`[ai] ${label}: ok with ${attempt.model} in ${Date.now() - started} ms`);
        return res.parsed_output as z.infer<T>;
      } catch (e) {
        last = explainAIError(e, attempt.model);
        console.warn(`[ai] ${label}: ${attempt.model} failed after ${Date.now() - started} ms — ${last.reason} [${raw(e)}]`);
        if (last.fatal) break; // a bad key or empty account won't be fixed by another model
      }
    }
    if (last.fatal || signal.aborted) throw last;
    // Last resort: ask for plain JSON text (no structured-output feature) and check it ourselves.
    const text = await this.askText(`${label} (plain)`,
      `${system}\n\nReply with only a JSON object matching this JSON Schema, with no other text:\n${JSON.stringify(z.toJSONSchema(schema))}`,
      user, CONFIG.ai.fallbackModel, signal, maxTokens);
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? schema.safeParse((() => { try { return JSON.parse(match[0]); } catch { return null; } })()) : null;
    if (parsed?.success) return parsed.data as z.infer<T>;
    console.warn(`[ai] ${label} (plain): reply was not valid JSON for the schema`);
    throw last;
  }

  /** Plain-text request (no structured output) — the last-resort path for hints. */
  private async askText(label: string, system: string, user: string, model: string, signal: AbortSignal, maxTokens = 300): Promise<string> {
    const started = Date.now();
    try {
      const res = await this.client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { signal });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ');
      console.log(`[ai] ${label}: ok with ${model} in ${Date.now() - started} ms`);
      return text;
    } catch (e) {
      const err = explainAIError(e, model);
      console.warn(`[ai] ${label}: ${model} failed after ${Date.now() - started} ms — ${err.reason} [${raw(e)}]`);
      throw err;
    }
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

  async define(word: string, signal: AbortSignal) {
    const out = await this.ask('definition', Define,
      'You write short, plain dictionary definitions, like a learner\'s dictionary. Give 1 to 3 of the most common senses. ' +
        'For each: the part of speech (noun, verb, adjective, adverb) and a definition under 15 words.',
      `Define the English word: ${word.toLowerCase()}`, [{ model: CONFIG.ai.fallbackModel }], 400, signal);
    return out.senses.slice(0, 3).map((s) => ({ pos: s.pos.toLowerCase().slice(0, 20), text: s.text.slice(0, 200) }));
  }

  async alternativeClue(answer: string, avoid: string[], difficulty: Difficulty, signal: AbortSignal): Promise<string> {
    const existing = avoid.filter(Boolean).map((c) => `<clue>${escapeClue(c)}</clue>`).join('\n') || '(none)';
    const base = `Answer: ${answer}\nPuzzle difficulty: ${difficulty}\nClue(s) the solver already has:\n${existing}`;
    const usable = (c: string) => {
      const clean = cleanClue(c.replace(/^["'“”]+|["'“”]+$/g, ''));
      return clean && !clueContainsAnswer(clean, answer) && !avoid.some((a) => a.trim().toLowerCase() === clean.toLowerCase()) ? clean : null;
    };

    let lastError: AIError | null = null;
    // 1. Structured request: main model, then the fast model.
    try {
      const { clue } = await this.ask('hint', AltClue, alternativeClueSystem(), base,
        [{ model: CONFIG.ai.hintModel, ms: CONFIG.ai.hintPrimaryMs }, { model: CONFIG.ai.fallbackModel }], 4000, signal);
      const ok = usable(clue);
      if (ok) return ok;
      console.warn(`[ai] hint: reply "${clue}" contained the answer or repeated a clue; asking again`);
    } catch (e) {
      lastError = explainAIError(e);
      if (lastError.fatal) throw lastError;
    }
    // 2. Plain-text request on the fast model, as a last resort.
    const text = await this.askText('hint (plain)', `${alternativeClueSystem()}\n\nReply with only the clue itself — no quotes, no explanation.`,
      `${base}\n\nThe clue must not contain "${answer}" or any form of it, and must differ from the clues above.`,
      CONFIG.ai.fallbackModel, signal);
    const ok = usable(text.split('\n')[0] ?? '');
    if (ok) return ok;
    console.warn(`[ai] hint (plain): reply "${text.slice(0, 120)}" was not usable`);
    throw lastError ?? new AIError('the AI kept giving clues that contained the answer', false);
  }
}

/**
 * Checks the key, credit and model access with free model lookups plus one
 * tiny request. Returns human-readable lines for the log.
 */
export async function runAISelfTest(ai: AnthropicClueAI): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [`  key: ${describeApiKey(ai.apiKey)}`];
  let ok = true;
  const models = [...new Set([CONFIG.ai.quickCheckModel, CONFIG.ai.reviewModel, CONFIG.ai.hintModel, CONFIG.ai.fallbackModel])];
  for (const model of models) {
    try {
      await ai.client.models.retrieve(model);
      lines.push(`  ✓ model ${model} is available`);
    } catch (e) {
      ok = false;
      lines.push(`  ✗ model ${model}: ${explainAIError(e, model).reason}`);
    }
  }
  try {
    await ai.client.messages.create({ model: CONFIG.ai.fallbackModel, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK.' }] });
    lines.push('  ✓ test request succeeded (key and credit are fine)');
  } catch (e) {
    ok = false;
    lines.push(`  ✗ test request failed: ${explainAIError(e, CONFIG.ai.fallbackModel).reason}  [${raw(e)}]`);
  }
  try {
    const res = await ai.client.messages.parse({
      model: CONFIG.ai.fallbackModel, max_tokens: 100,
      messages: [{ role: 'user', content: 'Write a 3-word crossword clue for CAT.' }],
      output_config: { format: zodOutputFormat(AltClue) },
    });
    if (!res.parsed_output) throw new Error(`no parsed output (${res.stop_reason})`);
    lines.push('  ✓ structured replies work');
  } catch (e) {
    ok = false;
    lines.push(`  ✗ structured replies failed: ${explainAIError(e, CONFIG.ai.fallbackModel).reason}  [${raw(e)}]`);
  }
  return { ok, lines };
}
