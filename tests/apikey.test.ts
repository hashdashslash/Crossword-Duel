import { describe, expect, it } from 'vitest';
import { cleanApiKey, describeApiKey } from '../server/ai/anthropic.js';

describe('API key cleanup', () => {
  it('removes copy-paste accidents', () => {
    expect(cleanApiKey('  sk-ant-abc123  \n')).toBe('sk-ant-abc123');
    expect(cleanApiKey('"sk-ant-abc123"')).toBe('sk-ant-abc123');
    expect(cleanApiKey("'sk-ant-abc123'")).toBe('sk-ant-abc123');
    expect(cleanApiKey('ANTHROPIC_API_KEY=sk-ant-abc123')).toBe('sk-ant-abc123');
    expect(cleanApiKey(undefined)).toBe('');
  });

  it('describes the key without revealing it', () => {
    const d = describeApiKey('sk-ant-api03-SECRETSECRET-qQAA');
    expect(d).toBe('starts with sk-ant-, ends in ...qQAA, 30 characters');
    expect(d).not.toContain('SECRET');
    expect(describeApiKey('...qQAA')).toContain('does NOT start with sk-ant-');
    expect(describeApiKey('')).toBe('empty');
  });
});
