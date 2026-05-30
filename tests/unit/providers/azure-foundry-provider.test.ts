/**
 * Unit Tests for AzureFoundryProvider (FLUX served by Microsoft Foundry).
 *
 * Tests configuration, model listing, and the SYNCHRONOUS single-POST flow
 * with a mocked global fetch. No real API calls are made.
 */

import { AzureFoundryProvider } from '../../../src/middleware/services/tti/providers/azure-foundry-provider';
import {
  InvalidConfigError,
  GenerationFailedError,
  CapabilityNotSupportedError,
} from '../../../src/middleware/services/tti/providers/base-tti-provider';
import { TTIProvider, TTIRequest } from '../../../src/middleware/types';

// ============================================================
// FETCH MOCK HELPERS
// ============================================================

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

/** Standard synchronous success envelope (OpenAI-images style). */
function imageEnvelope(b64 = 'QUJDRA==') {
  return { created: 1780163980, data: [{ b64_json: b64 }], request_meta: {} };
}

const ENDPOINT = 'https://res.services.ai.azure.com';

describe('AzureFoundryProvider', () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AZURE_FOUNDRY_API_KEY = 'test-key';
    process.env.AZURE_FOUNDRY_ENDPOINT = ENDPOINT;
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** Base request with retry disabled so failure tests don't wait/backoff. */
  const req = (overrides: Partial<TTIRequest> = {}): TTIRequest => ({
    prompt: 'a fox',
    retry: false,
    ...overrides,
  });

  // ----------------------------------------------------------
  // CONSTRUCTOR
  // ----------------------------------------------------------

  describe('constructor', () => {
    it('initializes from env', () => {
      const provider = new AzureFoundryProvider();
      expect(provider.getName()).toBe(TTIProvider.AZURE_FOUNDRY);
      expect(provider.getDisplayName()).toBe('Microsoft Foundry (FLUX)');
    });

    it('throws when API key is missing', () => {
      delete process.env.AZURE_FOUNDRY_API_KEY;
      expect(() => new AzureFoundryProvider()).toThrow(InvalidConfigError);
    });

    it('throws when endpoint is missing', () => {
      delete process.env.AZURE_FOUNDRY_ENDPOINT;
      expect(() => new AzureFoundryProvider()).toThrow(InvalidConfigError);
    });

    it('accepts explicit config', () => {
      delete process.env.AZURE_FOUNDRY_API_KEY;
      delete process.env.AZURE_FOUNDRY_ENDPOINT;
      expect(
        () => new AzureFoundryProvider({ apiKey: 'k', endpoint: ENDPOINT })
      ).not.toThrow();
    });
  });

  // ----------------------------------------------------------
  // MODELS
  // ----------------------------------------------------------

  describe('models', () => {
    it('lists the FLUX-on-Foundry models with -azure ids', () => {
      const ids = new AzureFoundryProvider().listModels().map((m) => m.id);
      expect(ids).toEqual([
        'flux-2-pro-azure',
        'flux-1.1-pro-azure',
        'flux-kontext-pro-azure',
        'flux-2-flex-azure',
      ]);
    });

    it('defaults to flux-2-pro-azure', () => {
      expect(new AzureFoundryProvider().getDefaultModel()).toBe('flux-2-pro-azure');
    });

    it('marks 2-pro/kontext as character-consistency capable, 1.1-pro not', () => {
      const models = new AzureFoundryProvider().listModels();
      expect(models.find((m) => m.id === 'flux-2-pro-azure')?.capabilities.characterConsistency).toBe(true);
      expect(models.find((m) => m.id === 'flux-kontext-pro-azure')?.capabilities.characterConsistency).toBe(true);
      expect(models.find((m) => m.id === 'flux-1.1-pro-azure')?.capabilities.characterConsistency).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // GENERATION FLOW (SYNCHRONOUS)
  // ----------------------------------------------------------

  describe('generate', () => {
    it('does a single synchronous POST and returns base64', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope('QUJDRA==')));
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(req());

      expect(fetchMock).toHaveBeenCalledTimes(1); // no poll loop
      expect(res.images).toHaveLength(1);
      expect(res.images[0].base64).toBe('QUJDRA==');
      expect(res.images[0].contentType).toBe('image/jpeg');
      expect(res.metadata.provider).toBe(TTIProvider.AZURE_FOUNDRY);
      expect(res.metadata.model).toBe('flux-2-pro-azure');
      expect(res.usage.imagesGenerated).toBe(1);
    });

    it('targets the BFL-provider path with Bearer auth + api-version', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(req());

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        `${ENDPOINT}/providers/blackforestlabs/v1/flux-2-pro?api-version=preview`
      );
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('FLUX.2-pro'); // public model name, not the path/id
      expect(body.num_images).toBe(1);
    });

    it('honours a custom api-version', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider({
        apiKey: 'k',
        endpoint: ENDPOINT,
        apiVersion: '2026-05-01',
      });
      await provider.generate(req());
      expect(fetchMock.mock.calls[0][0]).toContain('api-version=2026-05-01');
    });

    it('retries a transient 5xx then succeeds', async () => {
      let posts = 0;
      fetchMock.mockImplementation(() => {
        posts++;
        if (posts === 1) return Promise.resolve(jsonResponse({ error: 'overloaded' }, false, 503));
        return Promise.resolve(jsonResponse(imageEnvelope()));
      });
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(
        req({ retry: { maxRetries: 2, delayMs: 0, jitter: false, timeoutMs: 0 } })
      );
      expect(res.images).toHaveLength(1);
      expect(posts).toBe(2);
    });

    it('does NOT retry a 401 auth error', async () => {
      let posts = 0;
      fetchMock.mockImplementation(() => {
        posts++;
        return Promise.resolve(jsonResponse({ error: 'unauthorized' }, false, 401));
      });
      const provider = new AzureFoundryProvider();
      await expect(
        provider.generate(req({ retry: { maxRetries: 3, delayMs: 0, jitter: false, timeoutMs: 0 } }))
      ).rejects.toThrow(InvalidConfigError);
      expect(posts).toBe(1);
    });

    it('throws GenerationFailedError when no image data is returned', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ created: 1, data: [], request_meta: {} }));
      const provider = new AzureFoundryProvider();
      await expect(provider.generate(req())).rejects.toThrow(GenerationFailedError);
    });

    it('maps reference images to input_image fields (flux-2-pro)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(
        req({
          model: 'flux-2-pro-azure',
          prompt: 'edit this',
          referenceImages: [{ base64: 'AAA' }, { base64: 'BBB' }],
        })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.input_image).toBe('AAA');
      expect(body.input_image_2).toBe('BBB');
    });

    it('structured mode wraps the prompt with the shared consistency template', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(
        req({
          prompt: 'dancing in the rain',
          model: 'flux-kontext-pro-azure',
          referenceImages: [{ base64: 'AAA' }],
          subjectDescription: 'cute cartoon bear with red hat',
        })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.prompt).toContain('cute cartoon bear with red hat');
      expect(body.prompt).toContain('the reference image');
      expect(body.prompt).toContain('dancing in the rain');
      expect(body.prompt).toContain('Maintain exact visual consistency');
    });

    it('index-based mode passes the prompt verbatim', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(
        req({
          prompt: 'The bear from the reference image, dancing',
          model: 'flux-kontext-pro-azure',
          referenceImages: [{ base64: 'AAA' }],
        })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.prompt).toBe('The bear from the reference image, dancing');
    });

    it('uses aspect_ratio for kontext but width/height otherwise', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();

      await provider.generate(req({ model: 'flux-kontext-pro-azure', aspectRatio: '16:9' }));
      const kontextBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(kontextBody.aspect_ratio).toBe('16:9');
      expect(kontextBody.width).toBeUndefined();

      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      await provider.generate(req({ model: 'flux-2-pro-azure', aspectRatio: '16:9' }));
      const proBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(proBody.width).toBe(1344);
      expect(proBody.height).toBe(768);
    });

    it('passes provider options through but strips control keys', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(
        req({ providerOptions: { guidance: 4.5, steps: 30, outputFormat: 'png', returnUrls: false } })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.guidance).toBe(4.5);
      expect(body.steps).toBe(30);
      expect(body.output_format).toBe('png');
      expect(body.outputFormat).toBeUndefined(); // control key not leaked
      expect(body.returnUrls).toBeUndefined();
    });

    it('returns a url when returnUrls is set and the response carries one', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ created: 1, data: [{ url: 'https://img.example/out.jpg' }], request_meta: {} })
      );
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(req({ providerOptions: { returnUrls: true } }));
      expect(res.images[0].url).toBe('https://img.example/out.jpg');
      expect(res.images[0].base64).toBeUndefined();
    });

    it('parses multiple images from data[] (response side)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ created: 1, data: [{ b64_json: 'AAA' }, { b64_json: 'BBB' }], request_meta: {} })
      );
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(req());
      expect(res.images).toHaveLength(2);
    });

    it('clamps num_images to the model maxImagesPerRequest (request side)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      await provider.generate(req({ n: 4 })); // flux-2-pro-azure max = 1
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.num_images).toBe(1);
    });

    it('does NOT retry on timeout — non-idempotent generation, no double charge', async () => {
      // fetch resolves AFTER the per-attempt timeout fires. withSafeRetry forces
      // timeoutRetries:0, so there must be exactly one POST (no re-submit).
      // Without the guard the base default (timeoutRetries:2) would POST 3×.
      let calls = 0;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            calls++;
            setTimeout(() => resolve(jsonResponse(imageEnvelope())), 60);
          })
      );
      const provider = new AzureFoundryProvider();
      await expect(
        provider.generate(req({ retry: { timeoutMs: 10, delayMs: 0, jitter: false } }))
      ).rejects.toThrow();
      expect(calls).toBe(1);
    });

    it('rejects reference images on a text-only model (flux-1.1-pro-azure)', async () => {
      const provider = new AzureFoundryProvider();
      await expect(
        provider.generate(req({ model: 'flux-1.1-pro-azure', referenceImages: [{ base64: 'AAA' }] }))
      ).rejects.toThrow(CapabilityNotSupportedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still generates flux-2-flex-azure (registration is a deploy-time concern)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(imageEnvelope()));
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(req({ model: 'flux-2-flex-azure' }));
      expect(res.images).toHaveLength(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe('FLUX.2-flex');
    });

    it('rejects an unknown model', async () => {
      const provider = new AzureFoundryProvider();
      await expect(provider.generate(req({ model: 'not-a-model' }))).rejects.toThrow(
        InvalidConfigError
      );
    });

    it('does not call the API in dry mode', async () => {
      const provider = new AzureFoundryProvider();
      const res = await provider.generate(req({ dry: true }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.images.length).toBeGreaterThan(0);
    });
  });
});
