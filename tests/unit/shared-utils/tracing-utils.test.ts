import { describe, expect, it } from 'vitest';
import {
  createChildTraceparent,
  createRootTraceparent,
  parseTraceparent,
} from '../../../packages/shared-utils/src/tracing.js';

describe('shared-utils tracing utilities', () => {
  it('creates a valid root traceparent', () => {
    const traceparent = createRootTraceparent();
    const parsed = parseTraceparent(traceparent);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toHaveLength(32);
    expect(parsed?.parentId).toHaveLength(16);
  });

  it('creates child traceparent preserving trace id from parent', () => {
    const root = createRootTraceparent();
    const rootParsed = parseTraceparent(root);
    expect(rootParsed).not.toBeNull();

    const child = createChildTraceparent(root);
    const childParsed = parseTraceparent(child);
    expect(childParsed).not.toBeNull();
    expect(childParsed?.traceId).toBe(rootParsed?.traceId);
    expect(childParsed?.parentId).not.toBe(rootParsed?.parentId);
  });

  it('falls back to new trace when incoming traceparent is invalid', () => {
    const child = createChildTraceparent('invalid');
    const parsed = parseTraceparent(child);
    expect(parsed).not.toBeNull();
  });
});
