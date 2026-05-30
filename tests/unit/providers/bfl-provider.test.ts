/**
 * Unit Tests for BflProvider (Black Forest Labs / FLUX)
 *
 * Tests configuration, model listing, and the asynchronous submit -> poll ->
 * download flow with a mocked global fetch. No real API calls are made.
 */

import { BflProvider } from '../../../src/middleware/services/tti/providers/bfl-provider';
import {
  InvalidConfigError,
  GenerationFailedError,
} from '../../../src/middleware/services/tti/providers/base-tti-provider';
import { TTIProvider, TTIRequest } from '../../../src/middleware/types';

// ============================================================
// FETCH MOCK HELPERS
// ============================================================

type FetchHandler = (url: string, init?: RequestInit) => unknown;

/** Build a minimal Response-like object for a JSON body. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  };
}

/** Build a Response-like object for a binary image download. */
function imageResponse(bytes = [1, 2, 3, 4], contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  };
}

describe('BflProvider', () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.BFL_API_KEY = 'test-key';
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** A base request with fast polling so tests don't wait the real 1.5s interval. */
  const fast = (overrides: Partial<TTIRequest> = {}): TTIRequest => ({
    prompt: 'a fox',
    retry: false,
    ...overrides,
    providerOptions: { pollIntervalMs: 0, ...(overrides.providerOptions || {}) },
  });

  /** Wire fetch to a sequence: submit -> poll(s) -> download. */
  function wireHappyPath(handler?: FetchHandler) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (handler) {
        const custom = handler(url, init);
        if (custom !== undefined) return custom;
      }
      // POST submit
      if (init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ id: 'job-1', polling_url: 'https://api.eu.bfl.ai/poll/job-1' })
        );
      }
      // GET poll
      if (url.includes('/poll/')) {
        return Promise.resolve(
          jsonResponse({
            id: 'job-1',
            status: 'Ready',
            result: { sample: 'https://delivery-eu.bfl.ai/sample.jpg' },
          })
        );
      }
      // GET image download
      return Promise.resolve(imageResponse());
    });
  }

  // ----------------------------------------------------------
  // CONSTRUCTOR
  // ----------------------------------------------------------

  describe('constructor', () => {
    it('initializes with the EU endpoint by default', () => {
      const provider = new BflProvider();
      expect(provider.getName()).toBe(TTIProvider.BFL);
      expect(provider.getDisplayName()).toBe('Black Forest Labs (FLUX)');
    });

    it('throws when API key is missing', () => {
      delete process.env.BFL_API_KEY;
      expect(() => new BflProvider()).toThrow(InvalidConfigError);
    });

    it('accepts an explicit config key', () => {
      delete process.env.BFL_API_KEY;
      expect(() => new BflProvider({ apiKey: 'explicit' })).not.toThrow();
    });
  });

  // ----------------------------------------------------------
  // MODELS
  // ----------------------------------------------------------

  describe('models', () => {
    it('lists the three FLUX models', () => {
      const provider = new BflProvider();
      const ids = provider.listModels().map((m) => m.id);
      expect(ids).toEqual(['flux-1.1-pro', 'flux-kontext-pro', 'flux-2-pro']);
    });

    it('defaults to flux-1.1-pro', () => {
      expect(new BflProvider().getDefaultModel()).toBe('flux-1.1-pro');
    });

    it('marks kontext/2-pro as character-consistency capable', () => {
      const provider = new BflProvider();
      const models = provider.listModels();
      expect(models.find((m) => m.id === 'flux-kontext-pro')?.capabilities.characterConsistency).toBe(true);
      expect(models.find((m) => m.id === 'flux-1.1-pro')?.capabilities.characterConsistency).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // GENERATION FLOW
  // ----------------------------------------------------------

  describe('generate', () => {
    it('runs submit -> poll -> download and returns base64', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      const res = await provider.generate(fast());

      expect(res.images).toHaveLength(1);
      expect(res.images[0].base64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
      expect(res.images[0].contentType).toBe('image/jpeg');
      expect(res.metadata.provider).toBe(TTIProvider.BFL);
      expect(res.metadata.model).toBe('flux-1.1-pro');
      expect(res.usage.imagesGenerated).toBe(1);
    });

    it('submits to the EU endpoint with the x-key header', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      await provider.generate(fast());

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.eu.bfl.ai/v1/flux-pro-1.1');
      expect((init.headers as Record<string, string>)['x-key']).toBe('test-key');
      expect(init.method).toBe('POST');
    });

    it('keeps polling while status is Pending', async () => {
      let polls = 0;
      wireHappyPath((url) => {
        if (url.includes('/poll/')) {
          polls++;
          if (polls < 2) {
            return Promise.resolve(jsonResponse({ id: 'job-1', status: 'Pending' }));
          }
        }
        return undefined;
      });
      const provider = new BflProvider();
      const res = await provider.generate({
        prompt: 'a fox',
        retry: false,
        providerOptions: { pollIntervalMs: 0 },
      });
      expect(res.images).toHaveLength(1);
      expect(polls).toBeGreaterThanOrEqual(2);
    });

    it('submits exactly once even across many poll iterations (no re-submit)', async () => {
      // Regression: the poll must run OUTSIDE executeWithRetry so a long poll
      // never triggers a per-attempt timeout that re-submits (double charge).
      let posts = 0;
      let polls = 0;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts++;
          return Promise.resolve(
            jsonResponse({ id: 'job-1', polling_url: 'https://api.eu.bfl.ai/poll/job-1' })
          );
        }
        if (url.includes('/poll/')) {
          polls++;
          if (polls < 5) return Promise.resolve(jsonResponse({ id: 'job-1', status: 'Pending' }));
          return Promise.resolve(
            jsonResponse({ id: 'job-1', status: 'Ready', result: { sample: 'https://delivery-eu.bfl.ai/s.jpg' } })
          );
        }
        return Promise.resolve(imageResponse());
      });
      // retry ENABLED (default) — the dangerous path the bug lived on.
      const provider = new BflProvider();
      const res = await provider.generate({ prompt: 'a fox', providerOptions: { pollIntervalMs: 0 } });
      expect(res.images).toHaveLength(1);
      expect(posts).toBe(1); // exactly one billed job
      expect(polls).toBeGreaterThanOrEqual(5);
    });

    it('retries a transient 5xx submit error', async () => {
      // Regression: submitRequest throws a raw error with the status so the
      // base class isRetryableError classifies 5xx as retryable.
      let posts = 0;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts++;
          if (posts === 1) {
            return Promise.resolve(jsonResponse({ detail: 'overloaded' }, false, 503));
          }
          return Promise.resolve(
            jsonResponse({ id: 'job-1', polling_url: 'https://api.eu.bfl.ai/poll/job-1' })
          );
        }
        if (url.includes('/poll/')) {
          return Promise.resolve(
            jsonResponse({ id: 'job-1', status: 'Ready', result: { sample: 'https://delivery-eu.bfl.ai/s.jpg' } })
          );
        }
        return Promise.resolve(imageResponse());
      });
      const provider = new BflProvider();
      const res = await provider.generate({
        prompt: 'a fox',
        // small/fast retry so the test is quick
        retry: { maxRetries: 2, delayMs: 0, jitter: false, timeoutMs: 0 },
        providerOptions: { pollIntervalMs: 0 },
      });
      expect(res.images).toHaveLength(1);
      expect(posts).toBe(2); // first 503, retried once, then success
    });

    it('does NOT retry a 402 insufficient-credits submit error', async () => {
      let posts = 0;
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts++;
          return Promise.resolve(jsonResponse({ detail: 'Insufficient credits' }, false, 402));
        }
        return Promise.resolve(imageResponse());
      });
      const provider = new BflProvider();
      await expect(
        provider.generate({
          prompt: 'a fox',
          retry: { maxRetries: 3, delayMs: 0, jitter: false, timeoutMs: 0 },
        })
      ).rejects.toThrow(GenerationFailedError);
      expect(posts).toBe(1); // 402 is terminal — no retry, no extra charge
    });

    it('returns the raw URL when returnUrls is set', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      const res = await provider.generate(fast({ providerOptions: { returnUrls: true } }));
      expect(res.images[0].url).toBe('https://delivery-eu.bfl.ai/sample.jpg');
      expect(res.images[0].base64).toBeUndefined();
    });

    it('generates n images via parallel pipelines', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      const res = await provider.generate(fast({ n: 3 }));
      expect(res.images).toHaveLength(3);
      // 3 pipelines x (submit + poll + download) = 9 fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(9);
    });

    it('throws GenerationFailedError on content moderation', async () => {
      wireHappyPath((url) => {
        if (url.includes('/poll/')) {
          return Promise.resolve(jsonResponse({ id: 'job-1', status: 'Content Moderated' }));
        }
        return undefined;
      });
      const provider = new BflProvider();
      await expect(
        provider.generate({ prompt: 'bad', retry: false, providerOptions: { pollIntervalMs: 0 } })
      ).rejects.toThrow(GenerationFailedError);
    });

    it('maps reference images to input_image fields', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      const request = fast({
        prompt: 'edit this',
        model: 'flux-2-pro',
        referenceImages: [{ base64: 'AAA' }, { base64: 'BBB' }],
      });
      await provider.generate(request);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.input_image).toBe('AAA');
      expect(body.input_image_2).toBe('BBB');
    });

    it('structured mode: wraps prompt with consistency template when subjectDescription is set', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      await provider.generate(
        fast({
          prompt: 'dancing in the rain',
          model: 'flux-kontext-pro',
          referenceImages: [{ base64: 'AAA' }],
          subjectDescription: 'cute cartoon bear with red hat',
        })
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      // Same template the Google provider produces (shared base-class method).
      expect(body.prompt).toContain('cute cartoon bear with red hat');
      expect(body.prompt).toContain('the reference image');
      expect(body.prompt).toContain('dancing in the rain');
      expect(body.prompt).toContain('Maintain exact visual consistency');
    });

    it('index-based mode: passes prompt verbatim when subjectDescription is omitted', async () => {
      wireHappyPath();
      const provider = new BflProvider();
      await provider.generate(
        fast({
          prompt: 'The bear from the reference image, dancing in the rain',
          model: 'flux-kontext-pro',
          referenceImages: [{ base64: 'AAA' }],
          // subjectDescription intentionally omitted
        })
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.prompt).toBe('The bear from the reference image, dancing in the rain');
    });

    it('passes aspect_ratio for kontext but width/height for 1.1-pro', async () => {
      wireHappyPath();
      const provider = new BflProvider();

      await provider.generate(fast({ prompt: 'p', model: 'flux-kontext-pro', aspectRatio: '16:9' }));
      const kontextBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(kontextBody.aspect_ratio).toBe('16:9');
      expect(kontextBody.width).toBeUndefined();

      fetchMock.mockClear();
      wireHappyPath();
      await provider.generate(fast({ prompt: 'p', model: 'flux-1.1-pro', aspectRatio: '16:9' }));
      const proBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(proBody.width).toBe(1344);
      expect(proBody.height).toBe(768);
    });

    it('does not call the API in dry mode', async () => {
      const provider = new BflProvider();
      const res = await provider.generate({ prompt: 'a fox', dry: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.images.length).toBeGreaterThan(0);
    });
  });
});
