import { describe, it, expect } from 'vitest';
import {
  runExample,
  type TestdriveExample,
} from './helpers/example-harness.js';

function withMockedFetch(
  responder: (url: string) => Promise<Response>,
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) =>
    responder(String(url))) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('testdrive examples', () => {
  it('runs every example from testdrive/examples.js', async () => {
    // @ts-expect-error testdrive examples are plain JS fixtures.
    const mod = (await import('../testdrive/examples.js')) as {
      EXAMPLES: TestdriveExample[];
    };
    const examples = mod.EXAMPLES;
    expect(examples.length).toBeGreaterThan(0);

    for (const ex of examples) {
      let restoreFetch: (() => void) | null = null;
      if (ex.id === 'async') {
        restoreFetch = withMockedFetch(async (_url) => {
          return new Response(JSON.stringify({ fact: 'cats purr' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        });
      }
      try {
        const { result } = await runExample(ex);
        if (ex.id === 'return-type') {
          expect(
            result,
            `example '${ex.id}' should return a Verdict struct`,
          ).toMatchObject({
            level: expect.any(String),
            icon: expect.any(String),
            message: expect.any(String),
          });
        } else {
          expect(
            typeof result,
            `example '${ex.id}' should return a string`,
          ).toBe('string');
          expect(
            String(result).length,
            `example '${ex.id}' should return non-empty text`,
          ).toBeGreaterThan(0);
        }
      } finally {
        restoreFetch?.();
      }
    }
  });
});

