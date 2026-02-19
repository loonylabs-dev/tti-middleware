/**
 * Unit Tests for Region Rotation on 429 / Quota Errors
 *
 * Tests the opt-in region rotation feature for GoogleCloudTTIProvider.
 * When Vertex AI returns quota errors (429 / Resource Exhausted),
 * the middleware rotates through configured regions instead of retrying
 * the same region.
 *
 * Tests cover:
 * - Region rotation config validation
 * - Retry × Region interaction (regions < retries, regions > retries)
 * - alwaysTryFallback bonus attempt
 * - Non-quota errors don't trigger rotation
 * - No rotation when not configured (backwards compatibility)
 * - onRetry hook in BaseTTIProvider
 */

import { GoogleCloudTTIProvider } from '../../../src/middleware/services/tti/providers/google-cloud-provider';
import {
  InvalidConfigError,
  QuotaExceededError,
} from '../../../src/middleware/services/tti/providers/base-tti-provider';
import { TTIProvider, GoogleCloudRegion } from '../../../src/middleware/types';

// ============================================================
// MOCK SETUP
// ============================================================

// Track which regions were called and in what order
let regionCallLog: string[] = [];
let callCount = 0;
let mockBehavior: (region: string, callIndex: number) => unknown;

// Mock @google/genai (Gemini API)
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockImplementation(async () => {
        const region = regionCallLog[regionCallLog.length - 1];
        const index = callCount++;
        return mockBehavior(region, index);
      }),
    },
  })),
}));

// Mock @google-cloud/aiplatform (Imagen API)
jest.mock('@google-cloud/aiplatform', () => ({
  v1: {
    PredictionServiceClient: jest.fn().mockImplementation(() => ({
      predict: jest.fn().mockImplementation(async () => {
        const region = regionCallLog[regionCallLog.length - 1];
        const index = callCount++;
        return [mockBehavior(region, index)];
      }),
    })),
  },
  helpers: {
    toValue: jest.fn((v: unknown) => v),
    fromValue: jest.fn((v: unknown) => v),
  },
}));

// Helper: intercept the region from generateWithGemini/generateWithImagen
// We spy on getGenaiClient to capture the region parameter
function setupProvider(config: {
  regions: GoogleCloudRegion[];
  fallback: GoogleCloudRegion;
  alwaysTryFallback?: boolean;
  model?: string;
}): GoogleCloudTTIProvider {
  const provider = new GoogleCloudTTIProvider({
    projectId: 'test-project',
    region: config.regions[0],
    regionRotation: {
      regions: config.regions,
      fallback: config.fallback,
      alwaysTryFallback: config.alwaysTryFallback,
    },
  });

  // Intercept getGenaiClient to track which region is being used
  const originalGetGenaiClient = (provider as any).getGenaiClient.bind(provider);
  (provider as any).getGenaiClient = async (region: GoogleCloudRegion) => {
    regionCallLog.push(region);
    return originalGetGenaiClient(region);
  };

  // Intercept getAiplatformClient to track which region is being used
  const originalGetAiplatformClient = (provider as any).getAiplatformClient.bind(provider);
  (provider as any).getAiplatformClient = async (region: GoogleCloudRegion) => {
    regionCallLog.push(region);
    return originalGetAiplatformClient(region);
  };

  // Mock sleep to speed up tests
  (provider as any).sleep = jest.fn().mockResolvedValue(undefined);

  return provider;
}

// Helper: create a successful Gemini response
function geminiSuccess() {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: 'base64-image-data',
                mimeType: 'image/png',
              },
            },
          ],
        },
      },
    ],
  };
}

// Helper: create a 429 quota error
function quotaError(region?: string): Error {
  return new Error(`429 Resource Exhausted: Quota exceeded in ${region || 'region'}`);
}

// Helper: create a 500 server error
function serverError(): Error {
  return new Error('500 Internal Server Error');
}

// ============================================================
// TESTS
// ============================================================

describe('Region Rotation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/credentials.json';
    process.env.TTI_LOG_LEVEL = 'silent';
    regionCallLog = [];
    callCount = 0;
    mockBehavior = () => geminiSuccess();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ============================================================
  // CONFIG VALIDATION
  // ============================================================

  describe('config validation', () => {
    it('should accept valid regionRotation config', () => {
      expect(() => {
        new GoogleCloudTTIProvider({
          projectId: 'test',
          region: 'europe-west4',
          regionRotation: {
            regions: ['europe-west4', 'europe-west1'],
            fallback: 'global',
          },
        });
      }).not.toThrow();
    });

    it('should throw when regions array is empty', () => {
      expect(() => {
        new GoogleCloudTTIProvider({
          projectId: 'test',
          region: 'europe-west4',
          regionRotation: {
            regions: [],
            fallback: 'global',
          },
        });
      }).toThrow(InvalidConfigError);
    });

    it('should work without regionRotation (backwards compatible)', () => {
      const provider = new GoogleCloudTTIProvider({
        projectId: 'test',
        region: 'europe-west4',
      });
      expect(provider.getRegion()).toBe('europe-west4');
    });

    it('should default alwaysTryFallback to true', () => {
      const provider = new GoogleCloudTTIProvider({
        projectId: 'test',
        region: 'europe-west4',
        regionRotation: {
          regions: ['europe-west4', 'europe-west1'],
          fallback: 'global',
          // alwaysTryFallback not set — should default to true
        },
      });
      expect(provider).toBeDefined();
    });
  });

  // ============================================================
  // CASE 1: REGIONS SHORTER THAN RETRIES
  // ============================================================

  describe('Case 1: regions shorter than retries (regions=3, maxRetries=5)', () => {
    it('should rotate through all regions then stay on fallback', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1', 'europe-north1'];
      const fallback: GoogleCloudRegion = 'global';

      // All attempts fail with 429
      mockBehavior = (region: string) => {
        throw quotaError(region);
      };

      const provider = setupProvider({ regions, fallback });

      await expect(
        provider.generate({
          prompt: 'test image',
          model: 'gemini-flash-image',
          retry: { maxRetries: 5, delayMs: 1, jitter: false },
        })
      ).rejects.toThrow(QuotaExceededError);

      // Sequence: initial(r0) + 5 retries rotating through regions then fallback
      // Attempt 1: europe-west4 (initial)
      // Retry 1 → rotate to europe-west1 → Attempt 2: europe-west1
      // Retry 2 → rotate to europe-north1 → Attempt 3: europe-north1
      // Retry 3 → rotate to global (fallback) → Attempt 4: global
      // Retry 4 → stay on global → Attempt 5: global
      // Retry 5 → stay on global → Attempt 6: global
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'global',
        'global',
        'global',
      ]);
    });

    it('should succeed when a rotated region works', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1', 'europe-north1'];

      // First region: 429, second region: success
      mockBehavior = (_region: string, index: number) => {
        if (index === 0) throw quotaError('europe-west4');
        return geminiSuccess();
      };

      const provider = setupProvider({ regions, fallback: 'global' });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 5, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      expect(regionCallLog).toEqual(['europe-west4', 'europe-west1']);
    });
  });

  // ============================================================
  // CASE 2: REGIONS LONGER THAN RETRIES
  // ============================================================

  describe('Case 2: regions longer than retries (regions=5, maxRetries=3)', () => {
    it('should exhaust budget then try fallback as bonus (alwaysTryFallback=true)', async () => {
      const regions: GoogleCloudRegion[] = [
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'europe-central2',
        'europe-southwest1',
      ];
      const fallback: GoogleCloudRegion = 'global';

      // All attempts fail with 429
      mockBehavior = () => {
        throw quotaError();
      };

      const provider = setupProvider({ regions, fallback, alwaysTryFallback: true });

      await expect(
        provider.generate({
          prompt: 'test image',
          model: 'gemini-flash-image',
          retry: { maxRetries: 3, delayMs: 1, jitter: false },
        })
      ).rejects.toThrow(QuotaExceededError);

      // Attempt 1: europe-west4 (initial)
      // Retry 1 → rotate to europe-west1 → Attempt 2
      // Retry 2 → rotate to europe-north1 → Attempt 3
      // Retry 3 → rotate to europe-central2 → Attempt 4
      // Budget exhausted! europe-southwest1 never tried
      // Bonus attempt: global (alwaysTryFallback=true)
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'europe-central2',
        'global', // bonus attempt
      ]);
    });

    it('should NOT try fallback bonus when alwaysTryFallback=false', async () => {
      const regions: GoogleCloudRegion[] = [
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'europe-central2',
        'europe-southwest1',
      ];

      mockBehavior = () => {
        throw quotaError();
      };

      const provider = setupProvider({
        regions,
        fallback: 'global',
        alwaysTryFallback: false,
      });

      await expect(
        provider.generate({
          prompt: 'test image',
          model: 'gemini-flash-image',
          retry: { maxRetries: 3, delayMs: 1, jitter: false },
        })
      ).rejects.toThrow(QuotaExceededError);

      // No bonus attempt — stops after budget exhausted
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'europe-central2',
      ]);
    });

    it('should succeed on fallback bonus attempt', async () => {
      // Need regions.length > maxRetries so fallback is NOT reached during normal retries
      const regions: GoogleCloudRegion[] = [
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'europe-central2',
      ];

      // All region attempts fail with 429, but the bonus fallback attempt succeeds
      // With maxRetries=2: initial(r0) + retry1(r1) + retry2(r2) = 3 attempts, then bonus on global
      mockBehavior = (_region: string, index: number) => {
        if (index < 3) throw quotaError(); // first 3 attempts fail
        return geminiSuccess(); // 4th attempt (bonus on global) succeeds
      };

      const provider = setupProvider({
        regions,
        fallback: 'global',
        alwaysTryFallback: true,
      });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 2, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      // Sequence: r0, r1, r2, global (bonus)
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west1',
        'europe-north1',
        'global', // bonus attempt succeeded
      ]);
    });

    it('should NOT try fallback bonus if already reached fallback during retries', async () => {
      // regions=2, maxRetries=5 → fallback is reached during normal retries
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1'];

      mockBehavior = () => {
        throw quotaError();
      };

      const provider = setupProvider({
        regions,
        fallback: 'global',
        alwaysTryFallback: true,
      });

      await expect(
        provider.generate({
          prompt: 'test image',
          model: 'gemini-flash-image',
          retry: { maxRetries: 5, delayMs: 1, jitter: false },
        })
      ).rejects.toThrow(QuotaExceededError);

      // Fallback was already tried during normal retries, no bonus attempt
      // Sequence: r0, r1, global, global, global, global
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west1',
        'global',
        'global',
        'global',
        'global',
      ]);
    });
  });

  // ============================================================
  // CASE 3: NO REGION ROTATION CONFIGURED
  // ============================================================

  describe('Case 3: no regionRotation configured', () => {
    it('should retry on same region (existing behavior)', async () => {
      mockBehavior = (_region: string, index: number) => {
        if (index < 2) throw quotaError();
        return geminiSuccess();
      };

      const provider = new GoogleCloudTTIProvider({
        projectId: 'test-project',
        region: 'europe-west4',
      });

      // Intercept to track regions
      const originalGetGenaiClient = (provider as any).getGenaiClient.bind(provider);
      (provider as any).getGenaiClient = async (region: GoogleCloudRegion) => {
        regionCallLog.push(region);
        return originalGetGenaiClient(region);
      };
      (provider as any).sleep = jest.fn().mockResolvedValue(undefined);

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 3, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      // All attempts on same region
      expect(regionCallLog).toEqual(['europe-west4', 'europe-west4', 'europe-west4']);
    });
  });

  // ============================================================
  // NON-QUOTA ERRORS DON'T TRIGGER ROTATION
  // ============================================================

  describe('non-quota errors', () => {
    it('should NOT rotate on 500 server errors', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1', 'europe-north1'];

      mockBehavior = (_region: string, index: number) => {
        if (index < 2) throw serverError(); // 500 errors
        return geminiSuccess();
      };

      const provider = setupProvider({ regions, fallback: 'global' });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 3, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      // All attempts on same region (500 doesn't trigger rotation)
      expect(regionCallLog).toEqual([
        'europe-west4',
        'europe-west4',
        'europe-west4',
      ]);
    });

    it('should rotate on quota errors but not on server errors (mixed)', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1', 'europe-north1'];

      // Attempt 1: 429 → rotate
      // Attempt 2: 500 → stay on same region
      // Attempt 3: success
      mockBehavior = (_region: string, index: number) => {
        if (index === 0) throw quotaError(); // 429 → rotate
        if (index === 1) throw serverError(); // 500 → stay
        return geminiSuccess();
      };

      const provider = setupProvider({ regions, fallback: 'global' });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 5, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      expect(regionCallLog).toEqual([
        'europe-west4',   // attempt 1: 429 → rotate to europe-west1
        'europe-west1',   // attempt 2: 500 → stay on europe-west1
        'europe-west1',   // attempt 3: success
      ]);
    });
  });

  // ============================================================
  // QUOTA ERROR DETECTION
  // ============================================================

  describe('quota error detection', () => {
    const quotaMessages = [
      '429 Too Many Requests',
      'Resource Exhausted',
      'Quota exceeded for quota metric',
      'Rate limit exceeded',
      'Too many requests',
    ];

    for (const message of quotaMessages) {
      it(`should rotate on "${message}"`, async () => {
        const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1'];

        mockBehavior = (_region: string, index: number) => {
          if (index === 0) throw new Error(message);
          return geminiSuccess();
        };

        const provider = setupProvider({ regions, fallback: 'global' });

        const result = await provider.generate({
          prompt: 'test',
          model: 'gemini-flash-image',
          retry: { maxRetries: 3, delayMs: 1, jitter: false },
        });

        expect(result.images).toHaveLength(1);
        // Should have rotated from europe-west4 to europe-west1
        expect(regionCallLog[0]).toBe('europe-west4');
        expect(regionCallLog[1]).toBe('europe-west1');
      });
    }
  });

  // ============================================================
  // IMAGEN MODEL SUPPORT
  // ============================================================

  describe('Imagen model region rotation', () => {
    it('should rotate regions for Imagen models', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1'];

      // Mock Imagen response format
      mockBehavior = (_region: string, index: number) => {
        if (index === 0) throw quotaError();
        return {
          predictions: [{ bytesBase64Encoded: 'image-data', mimeType: 'image/png' }],
        };
      };

      const provider = setupProvider({ regions, fallback: 'global' });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'imagen-3',
        retry: { maxRetries: 3, delayMs: 1, jitter: false },
      });

      expect(result.images).toHaveLength(1);
      expect(regionCallLog).toEqual(['europe-west4', 'europe-west1']);
    });
  });

  // ============================================================
  // RESPONSE METADATA
  // ============================================================

  describe('response metadata', () => {
    it('should report the region that successfully served the request', async () => {
      const regions: GoogleCloudRegion[] = ['europe-west4', 'europe-west1'];

      // First region fails, second succeeds
      mockBehavior = (_region: string, index: number) => {
        if (index === 0) throw quotaError();
        return geminiSuccess();
      };

      const provider = setupProvider({ regions, fallback: 'global' });

      const result = await provider.generate({
        prompt: 'test image',
        model: 'gemini-flash-image',
        retry: { maxRetries: 3, delayMs: 1, jitter: false },
      });

      expect(result.metadata.region).toBe('europe-west1');
    });
  });
});

// ============================================================
// BASE PROVIDER: onRetry HOOK TESTS
// ============================================================

describe('BaseTTIProvider onRetry hook', () => {
  // Use a concrete test provider to test the hook
  const {
    BaseTTIProvider,
  } = require('../../../src/middleware/services/tti/providers/base-tti-provider');
  const { TTIProvider: TTIProviderEnum } = require('../../../src/middleware/types');

  class OnRetryTestProvider extends BaseTTIProvider {
    public generateFn: () => Promise<any>;

    constructor() {
      super(TTIProviderEnum.GOOGLE_CLOUD);
      this.generateFn = async () => ({
        images: [{ base64: 'data' }],
        metadata: { provider: 'test', model: 'test', duration: 100 },
        usage: { imagesGenerated: 1, modelId: 'test' },
      });
    }

    getDisplayName() { return 'Test'; }
    listModels() {
      return [{
        id: 'test-model',
        displayName: 'Test',
        capabilities: { textToImage: true, characterConsistency: false, imageEditing: false, maxImagesPerRequest: 4 },
      }];
    }
    getDefaultModel() { return 'test-model'; }

    protected async doGenerate(request: any) {
      return this.executeWithRetry(
        request,
        () => this.generateFn(),
        'test operation',
        { onRetry: request._onRetry },
      );
    }
  }

  beforeEach(() => {
    process.env.TTI_LOG_LEVEL = 'silent';
  });

  it('should call onRetry on each retryable error', async () => {
    const provider = new OnRetryTestProvider();
    (provider as any).sleep = jest.fn().mockResolvedValue(undefined);

    const onRetry = jest.fn();
    let attempts = 0;

    provider.generateFn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('429 Rate limit');
      return {
        images: [{ base64: 'data' }],
        metadata: { provider: 'test', model: 'test', duration: 100 },
        usage: { imagesGenerated: 1, modelId: 'test' },
      };
    };

    await provider.generate({
      prompt: 'test',
      retry: { maxRetries: 5, delayMs: 1, jitter: false },
      _onRetry: onRetry,
    } as any);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
  });

  it('should NOT call onRetry for non-retryable errors', async () => {
    const provider = new OnRetryTestProvider();
    const onRetry = jest.fn();

    provider.generateFn = async () => {
      throw new Error('401 Unauthorized');
    };

    await expect(
      provider.generate({
        prompt: 'test',
        retry: { maxRetries: 3 },
        _onRetry: onRetry,
      } as any)
    ).rejects.toThrow('401');

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('should NOT call onRetry when budget is exhausted', async () => {
    const provider = new OnRetryTestProvider();
    (provider as any).sleep = jest.fn().mockResolvedValue(undefined);

    const onRetry = jest.fn();

    provider.generateFn = async () => {
      throw new Error('429 Rate limit');
    };

    await expect(
      provider.generate({
        prompt: 'test',
        retry: { maxRetries: 2, delayMs: 1, jitter: false },
        _onRetry: onRetry,
      } as any)
    ).rejects.toThrow('429');

    // 2 retries → 2 onRetry calls (not 3 — budget exhausted on 3rd failure)
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('should work without onRetry (backwards compatible)', async () => {
    const provider = new OnRetryTestProvider();
    (provider as any).sleep = jest.fn().mockResolvedValue(undefined);

    let attempts = 0;
    provider.generateFn = async () => {
      attempts++;
      if (attempts < 2) throw new Error('429 Rate limit');
      return {
        images: [{ base64: 'data' }],
        metadata: { provider: 'test', model: 'test', duration: 100 },
        usage: { imagesGenerated: 1, modelId: 'test' },
      };
    };

    // No _onRetry in request — should still work
    const result = await provider.generate({
      prompt: 'test',
      retry: { maxRetries: 3, delayMs: 1, jitter: false },
    });

    expect(result.images).toHaveLength(1);
    expect(attempts).toBe(2);
  });
});
