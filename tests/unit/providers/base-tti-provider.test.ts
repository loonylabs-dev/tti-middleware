/**
 * Unit Tests for BaseTTIProvider
 *
 * Tests the abstract base class functionality including:
 * - Error handling and classification
 * - Request validation
 * - Retry logic
 * - Helper methods
 */

import {
  BaseTTIProvider,
  TTIError,
  InvalidConfigError,
  QuotaExceededError,
  ProviderUnavailableError,
  GenerationFailedError,
  NetworkError,
  CapabilityNotSupportedError,
  hasReferenceImages,
  isEURegion,
} from '../../../src/middleware/services/tti/providers/base-tti-provider';
import {
  TTIProvider,
  TTIRequest,
  TTIResponse,
  ModelInfo,
  DEFAULT_RETRY_OPTIONS,
} from '../../../src/middleware/types';

// ============================================================
// TEST IMPLEMENTATION
// ============================================================

/**
 * Concrete implementation of BaseTTIProvider for testing
 */
class TestTTIProvider extends BaseTTIProvider {
  private models: ModelInfo[];
  public generateFn: (request: TTIRequest) => Promise<TTIResponse>;

  constructor(models?: ModelInfo[]) {
    super(TTIProvider.GOOGLE_CLOUD);
    this.models = models || [
      {
        id: 'test-model',
        displayName: 'Test Model',
        capabilities: {
          textToImage: true,
          characterConsistency: false,
          imageEditing: false,
          maxImagesPerRequest: 4,
        },
      },
      {
        id: 'test-model-cc',
        displayName: 'Test Model with Character Consistency',
        capabilities: {
          textToImage: true,
          characterConsistency: true,
          imageEditing: false,
          maxImagesPerRequest: 1,
        },
      },
    ];
    this.generateFn = async () => ({
      images: [{ base64: 'test-image-data', contentType: 'image/png' }],
      metadata: { provider: 'test', model: 'test-model', duration: 100 },
      usage: { imagesGenerated: 1, modelId: 'test-model' },
    });
  }

  getDisplayName(): string {
    return 'Test Provider';
  }

  listModels(): ModelInfo[] {
    return this.models;
  }

  getDefaultModel(): string {
    return 'test-model';
  }

  protected async doGenerate(request: TTIRequest): Promise<TTIResponse> {
    // Note: validateRequest() is called by BaseTTIProvider.generate()
    return this.executeWithRetry(
      request,
      () => this.generateFn(request),
      'test generation'
    );
  }

  // Expose protected methods for testing
  public testValidateRequest(request: TTIRequest): void {
    return this.validateRequest(request);
  }

  public testHandleError(error: Error, context?: string): TTIError {
    return this.handleError(error, context);
  }

  public testIsRateLimitError(error: Error): boolean {
    return this.isRateLimitError(error);
  }

  public testIsRetryableError(error: Error): boolean {
    return this.isRetryableError(error);
  }

  public testResolveRetryConfig(request: TTIRequest) {
    return this.resolveRetryConfig(request);
  }

  public testCalculateRetryDelay(attempt: number, config: Required<Omit<import('../../../src/middleware/types').RetryOptions, 'incrementalBackoff'>>) {
    return this.calculateRetryDelay(attempt, config);
  }
}

// ============================================================
// ERROR CLASS TESTS
// ============================================================

describe('TTI Error Classes', () => {
  describe('TTIError', () => {
    it('should create error with all properties', () => {
      const cause = new Error('Original error');
      const error = new TTIError('test-provider', 'GENERATION_FAILED', 'Test message', cause);

      expect(error.provider).toBe('test-provider');
      expect(error.code).toBe('GENERATION_FAILED');
      expect(error.message).toBe('Test message');
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('TTIError');
    });

    it('should format toString correctly', () => {
      const error = new TTIError('test', 'INVALID_CONFIG', 'Config issue');
      expect(error.toString()).toBe('[test] INVALID_CONFIG: Config issue');
    });

    it('should include cause in toString when present', () => {
      const cause = new Error('Root cause');
      const error = new TTIError('test', 'NETWORK_ERROR', 'Failed', cause);
      expect(error.toString()).toContain('caused by: Root cause');
    });
  });

  describe('InvalidConfigError', () => {
    it('should have correct error code', () => {
      const error = new InvalidConfigError('test', 'Bad config');
      expect(error.code).toBe('INVALID_CONFIG');
      expect(error.name).toBe('InvalidConfigError');
    });
  });

  describe('QuotaExceededError', () => {
    it('should have correct error code', () => {
      const error = new QuotaExceededError('test');
      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.name).toBe('QuotaExceededError');
    });

    it('should use default message when none provided', () => {
      const error = new QuotaExceededError('test');
      expect(error.message).toContain('quota');
    });
  });

  describe('ProviderUnavailableError', () => {
    it('should have correct error code', () => {
      const error = new ProviderUnavailableError('test');
      expect(error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(error.name).toBe('ProviderUnavailableError');
    });
  });

  describe('GenerationFailedError', () => {
    it('should have correct error code', () => {
      const error = new GenerationFailedError('test', 'Generation failed');
      expect(error.code).toBe('GENERATION_FAILED');
      expect(error.name).toBe('GenerationFailedError');
    });
  });

  describe('NetworkError', () => {
    it('should have correct error code', () => {
      const error = new NetworkError('test', 'Connection failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.name).toBe('NetworkError');
    });
  });

  describe('CapabilityNotSupportedError', () => {
    it('should have correct error code and message', () => {
      const error = new CapabilityNotSupportedError('test', 'characterConsistency', 'model-x');
      expect(error.code).toBe('CAPABILITY_NOT_SUPPORTED');
      expect(error.name).toBe('CapabilityNotSupportedError');
      expect(error.message).toContain('characterConsistency');
      expect(error.message).toContain('model-x');
    });
  });
});

// ============================================================
// HELPER FUNCTION TESTS
// ============================================================

describe('Helper Functions', () => {
  describe('hasReferenceImages', () => {
    it('should return true when reference images exist', () => {
      const request: TTIRequest = {
        prompt: 'test',
        referenceImages: [{ base64: 'data', mimeType: 'image/png' }],
        subjectDescription: 'test subject',
      };
      expect(hasReferenceImages(request)).toBe(true);
    });

    it('should return false when no reference images', () => {
      const request: TTIRequest = { prompt: 'test' };
      expect(hasReferenceImages(request)).toBe(false);
    });

    it('should return false when reference images is empty array', () => {
      const request: TTIRequest = { prompt: 'test', referenceImages: [] };
      expect(hasReferenceImages(request)).toBe(false);
    });

    it('should return false when reference images is undefined', () => {
      const request: TTIRequest = { prompt: 'test', referenceImages: undefined };
      expect(hasReferenceImages(request)).toBe(false);
    });
  });

  describe('isEURegion', () => {
    it('should return true for EU regions', () => {
      expect(isEURegion('europe-west1')).toBe(true);
      expect(isEURegion('europe-west2')).toBe(true);
      expect(isEURegion('europe-west3')).toBe(true);
      expect(isEURegion('europe-west4')).toBe(true);
      expect(isEURegion('europe-west9')).toBe(true);
      expect(isEURegion('europe-north1')).toBe(true);
      expect(isEURegion('europe-central2')).toBe(true);
    });

    it('should return false for non-EU regions', () => {
      expect(isEURegion('us-central1')).toBe(false);
      expect(isEURegion('us-east4')).toBe(false);
      expect(isEURegion('asia-east1')).toBe(false);
    });
  });
});

// ============================================================
// BASE PROVIDER TESTS
// ============================================================

describe('BaseTTIProvider', () => {
  let provider: TestTTIProvider;

  beforeEach(() => {
    provider = new TestTTIProvider();
  });

  describe('getName()', () => {
    it('should return the provider name', () => {
      expect(provider.getName()).toBe(TTIProvider.GOOGLE_CLOUD);
    });
  });

  describe('getDisplayName()', () => {
    it('should return human-readable name', () => {
      expect(provider.getDisplayName()).toBe('Test Provider');
    });
  });

  describe('listModels()', () => {
    it('should return available models', () => {
      const models = provider.listModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('test-model');
    });
  });

  describe('getDefaultModel()', () => {
    it('should return default model', () => {
      expect(provider.getDefaultModel()).toBe('test-model');
    });
  });

  describe('validateRequest()', () => {
    it('should pass for valid request', () => {
      expect(() => {
        provider.testValidateRequest({ prompt: 'A beautiful sunset' });
      }).not.toThrow();
    });

    it('should throw for empty prompt', () => {
      expect(() => {
        provider.testValidateRequest({ prompt: '' });
      }).toThrow(InvalidConfigError);
    });

    it('should throw for whitespace-only prompt', () => {
      expect(() => {
        provider.testValidateRequest({ prompt: '   ' });
      }).toThrow(InvalidConfigError);
    });

    it('should throw when using referenceImages with non-supporting model', () => {
      expect(() => {
        provider.testValidateRequest({
          prompt: 'test',
          model: 'test-model', // Does not support character consistency
          referenceImages: [{ base64: 'data' }],
          subjectDescription: 'test',
        });
      }).toThrow(CapabilityNotSupportedError);
    });

    it('should pass when using referenceImages with supporting model', () => {
      expect(() => {
        provider.testValidateRequest({
          prompt: 'test',
          model: 'test-model-cc', // Supports character consistency
          referenceImages: [{ base64: 'data' }],
          subjectDescription: 'test subject',
        });
      }).not.toThrow();
    });

    it('should allow referenceImages without subjectDescription (raw multimodal mode)', () => {
      // Since the validation was relaxed to support index-based referencing,
      // referenceImages without subjectDescription is now valid.
      expect(() => {
        provider.testValidateRequest({
          prompt: 'Generate with FIRST reference image on left, SECOND on right',
          model: 'test-model-cc',
          referenceImages: [{ base64: 'data1' }, { base64: 'data2' }],
          // subjectDescription intentionally omitted for raw multimodal mode
        });
      }).not.toThrow();
    });

    it('should throw when referenceImage has empty base64', () => {
      expect(() => {
        provider.testValidateRequest({
          prompt: 'test',
          model: 'test-model-cc',
          referenceImages: [{ base64: '' }],
          subjectDescription: 'test',
        });
      }).toThrow(InvalidConfigError);
    });
  });

  describe('handleError()', () => {
    it('should return TTIError instances unchanged', () => {
      const original = new QuotaExceededError('test');
      const result = provider.testHandleError(original);
      expect(result).toBe(original);
    });

    it('should classify 401 errors as InvalidConfigError', () => {
      const error = provider.testHandleError(new Error('Request failed with status 401'));
      expect(error).toBeInstanceOf(InvalidConfigError);
    });

    it('should classify 403 errors as InvalidConfigError', () => {
      const error = provider.testHandleError(new Error('Request failed with status 403'));
      expect(error).toBeInstanceOf(InvalidConfigError);
    });

    it('should classify 429 errors as QuotaExceededError', () => {
      const error = provider.testHandleError(new Error('Request failed with status 429'));
      expect(error).toBeInstanceOf(QuotaExceededError);
    });

    it('should classify 503 errors as ProviderUnavailableError', () => {
      const error = provider.testHandleError(new Error('Request failed with status 503'));
      expect(error).toBeInstanceOf(ProviderUnavailableError);
    });

    it('should classify timeout errors as NetworkError', () => {
      const error = provider.testHandleError(new Error('Request timeout'));
      expect(error).toBeInstanceOf(NetworkError);
    });

    it('should classify connection errors as NetworkError', () => {
      const error = provider.testHandleError(new Error('ECONNREFUSED'));
      expect(error).toBeInstanceOf(NetworkError);
    });

    it('should classify other errors as GenerationFailedError', () => {
      const error = provider.testHandleError(new Error('Unknown error'));
      expect(error).toBeInstanceOf(GenerationFailedError);
    });

    it('should include context in error message', () => {
      const error = provider.testHandleError(new Error('Failed'), 'during API call');
      expect(error.message).toContain('during API call');
    });
  });

  describe('isRateLimitError() (deprecated, delegates to isRetryableError)', () => {
    it('should detect 429 errors', () => {
      expect(provider.testIsRateLimitError(new Error('status 429'))).toBe(true);
    });

    it('should detect rate limit messages', () => {
      expect(provider.testIsRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    });
  });

  describe('isRetryableError()', () => {
    // Retryable HTTP status codes
    it('should retry 429 (rate limit)', () => {
      expect(provider.testIsRetryableError(new Error('status 429'))).toBe(true);
    });

    it('should retry 408 (request timeout)', () => {
      expect(provider.testIsRetryableError(new Error('status 408'))).toBe(true);
    });

    it('should retry 500 (internal server error)', () => {
      expect(provider.testIsRetryableError(new Error('status 500'))).toBe(true);
    });

    it('should retry 502 (bad gateway)', () => {
      expect(provider.testIsRetryableError(new Error('status 502'))).toBe(true);
    });

    it('should retry 503 (service unavailable)', () => {
      expect(provider.testIsRetryableError(new Error('status 503'))).toBe(true);
    });

    it('should retry 504 (gateway timeout)', () => {
      expect(provider.testIsRetryableError(new Error('status 504'))).toBe(true);
    });

    // Retryable by description
    it('should retry "rate limit exceeded"', () => {
      expect(provider.testIsRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    });

    it('should retry "quota exceeded"', () => {
      expect(provider.testIsRetryableError(new Error('Quota exceeded'))).toBe(true);
    });

    it('should retry "too many requests"', () => {
      expect(provider.testIsRetryableError(new Error('Too many requests'))).toBe(true);
    });

    it('should retry "resource exhausted"', () => {
      expect(provider.testIsRetryableError(new Error('Resource exhausted'))).toBe(true);
    });

    // Network / timeout errors
    it('should retry on timeout', () => {
      expect(provider.testIsRetryableError(new Error('Request timeout'))).toBe(true);
    });

    it('should retry on ETIMEDOUT', () => {
      expect(provider.testIsRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    });

    it('should retry on ECONNRESET', () => {
      expect(provider.testIsRetryableError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should retry on ECONNREFUSED', () => {
      expect(provider.testIsRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('should retry on ECONNABORTED', () => {
      expect(provider.testIsRetryableError(new Error('ECONNABORTED'))).toBe(true);
    });

    it('should retry on socket hang up', () => {
      expect(provider.testIsRetryableError(new Error('socket hang up'))).toBe(true);
    });

    // Non-retryable
    it('should NOT retry 401 (unauthorized)', () => {
      expect(provider.testIsRetryableError(new Error('status 401'))).toBe(false);
    });

    it('should NOT retry 403 (forbidden)', () => {
      expect(provider.testIsRetryableError(new Error('status 403'))).toBe(false);
    });

    it('should NOT retry 400 (bad request)', () => {
      expect(provider.testIsRetryableError(new Error('status 400'))).toBe(false);
    });

    it('should NOT retry unknown errors', () => {
      expect(provider.testIsRetryableError(new Error('Invalid prompt format'))).toBe(false);
    });
  });
});

// ============================================================
// RETRY LOGIC TESTS
// ============================================================

describe('Retry Logic', () => {
  let provider: TestTTIProvider;

  beforeEach(() => {
    provider = new TestTTIProvider();
  });

  describe('resolveRetryConfig()', () => {
    it('should return defaults when retry is undefined', () => {
      const config = provider.testResolveRetryConfig({ prompt: 'test' });
      expect(config).toEqual(DEFAULT_RETRY_OPTIONS);
    });

    it('should return defaults when retry is true', () => {
      const config = provider.testResolveRetryConfig({ prompt: 'test', retry: true });
      expect(config).toEqual(DEFAULT_RETRY_OPTIONS);
    });

    it('should return null when retry is false', () => {
      const config = provider.testResolveRetryConfig({ prompt: 'test', retry: false });
      expect(config).toBeNull();
    });

    it('should merge custom config with defaults', () => {
      const config = provider.testResolveRetryConfig({
        prompt: 'test',
        retry: { maxRetries: 5 },
      });
      expect(config?.maxRetries).toBe(5);
      expect(config?.delayMs).toBe(DEFAULT_RETRY_OPTIONS.delayMs);
      expect(config?.backoffMultiplier).toBe(DEFAULT_RETRY_OPTIONS.backoffMultiplier);
      expect(config?.maxDelayMs).toBe(DEFAULT_RETRY_OPTIONS.maxDelayMs);
      expect(config?.jitter).toBe(DEFAULT_RETRY_OPTIONS.jitter);
    });

    it('should handle all custom options', () => {
      const config = provider.testResolveRetryConfig({
        prompt: 'test',
        retry: { maxRetries: 5, delayMs: 2000, backoffMultiplier: 3.0, maxDelayMs: 60000, jitter: false },
      });
      expect(config).toEqual({
        maxRetries: 5, delayMs: 2000, backoffMultiplier: 3.0, maxDelayMs: 60000, jitter: false,
        timeoutMs: 45000, timeoutRetries: 2,
      });
    });

    it('should handle deprecated incrementalBackoff gracefully', () => {
      const config = provider.testResolveRetryConfig({
        prompt: 'test',
        retry: { incrementalBackoff: true },
      });
      expect(config?.backoffMultiplier).toBeDefined();
      expect(config?.maxRetries).toBe(DEFAULT_RETRY_OPTIONS.maxRetries);
    });
  });

  describe('calculateRetryDelay()', () => {
    const baseConfig = {
      maxRetries: 3, delayMs: 1000, backoffMultiplier: 2.0, maxDelayMs: 30000, jitter: false,
      timeoutMs: 45000, timeoutRetries: 2,
    };

    it('should return exponential delays without jitter', () => {
      expect(provider.testCalculateRetryDelay(1, baseConfig)).toBe(1000);  // 1000 * 2^0
      expect(provider.testCalculateRetryDelay(2, baseConfig)).toBe(2000);  // 1000 * 2^1
      expect(provider.testCalculateRetryDelay(3, baseConfig)).toBe(4000);  // 1000 * 2^2
      expect(provider.testCalculateRetryDelay(4, baseConfig)).toBe(8000);  // 1000 * 2^3
    });

    it('should cap delay at maxDelayMs', () => {
      const config = { ...baseConfig, maxDelayMs: 5000 };
      expect(provider.testCalculateRetryDelay(4, config)).toBe(5000); // 8000 capped to 5000
    });

    it('should return constant delay with multiplier 1.0', () => {
      const config = { ...baseConfig, backoffMultiplier: 1.0 };
      expect(provider.testCalculateRetryDelay(1, config)).toBe(1000);
      expect(provider.testCalculateRetryDelay(2, config)).toBe(1000);
      expect(provider.testCalculateRetryDelay(3, config)).toBe(1000);
    });

    it('should apply jitter (delay between 0 and computed)', () => {
      const config = { ...baseConfig, jitter: true };
      // Run multiple times — all values should be <= computed delay
      for (let i = 0; i < 20; i++) {
        const delay = provider.testCalculateRetryDelay(2, config);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(2000); // 1000 * 2^1
      }
    });
  });

  describe('executeWithRetry()', () => {
    it('should succeed on first attempt', async () => {
      const result = await provider.generate({ prompt: 'test' });
      expect(result.images).toHaveLength(1);
    });

    it('should retry on rate limit error', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('429 Rate limit exceeded');
        }
        return {
          images: [{ base64: 'data' }],
          metadata: { provider: 'test', model: 'test', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test' },
        };
      };

      const result = await provider.generate({
        prompt: 'test',
        retry: { maxRetries: 2, delayMs: 10 }, // Short delay for tests
      });

      expect(attempts).toBe(2);
      expect(result.images).toHaveLength(1);
    });

    it('should retry on 503 server error', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('503 Service Unavailable');
        }
        return {
          images: [{ base64: 'data' }],
          metadata: { provider: 'test', model: 'test', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test' },
        };
      };

      const result = await provider.generate({
        prompt: 'test',
        retry: { maxRetries: 2, delayMs: 10, jitter: false },
      });

      expect(attempts).toBe(2);
      expect(result.images).toHaveLength(1);
    });

    it('should retry on network timeout (ETIMEDOUT)', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ETIMEDOUT');
        }
        return {
          images: [{ base64: 'data' }],
          metadata: { provider: 'test', model: 'test', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test' },
        };
      };

      const result = await provider.generate({
        prompt: 'test',
        retry: { maxRetries: 2, delayMs: 10, jitter: false },
      });

      expect(attempts).toBe(2);
      expect(result.images).toHaveLength(1);
    });

    it('should not retry on non-retryable errors (401)', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        throw new Error('status 401 Unauthorized');
      };

      await expect(provider.generate({ prompt: 'test', retry: { maxRetries: 2 } })).rejects.toThrow(
        '401'
      );
      expect(attempts).toBe(1);
    });

    it('should not retry on non-retryable errors (Invalid prompt)', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        throw new Error('Invalid prompt');
      };

      await expect(provider.generate({ prompt: 'test', retry: { maxRetries: 2 } })).rejects.toThrow(
        'Invalid prompt'
      );
      expect(attempts).toBe(1);
    });

    it('should exhaust retries and throw last error', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        throw new Error('429 Rate limit');
      };

      await expect(
        provider.generate({ prompt: 'test', retry: { maxRetries: 2, delayMs: 10, jitter: false } })
      ).rejects.toThrow('429 Rate limit');
      expect(attempts).toBe(3); // 1 initial + 2 retries
    });

    it('should not retry when retry is disabled', async () => {
      let attempts = 0;
      provider.generateFn = async () => {
        attempts++;
        throw new Error('429 Rate limit');
      };

      await expect(provider.generate({ prompt: 'test', retry: false })).rejects.toThrow();
      expect(attempts).toBe(1);
    });

    it('should use exponential backoff delays between retries', async () => {
      const sleepSpy = jest.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

      provider.generateFn = async () => {
        throw new Error('429 Rate limit');
      };

      await expect(
        provider.generate({
          prompt: 'test',
          retry: { maxRetries: 4, delayMs: 1000, backoffMultiplier: 2.0, maxDelayMs: 30000, jitter: false },
        })
      ).rejects.toThrow('429 Rate limit');

      // 4 retries → 4 sleep calls
      expect(sleepSpy).toHaveBeenCalledTimes(4);

      // Verify exponential delays: 1000, 2000, 4000, 8000
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000); // 1000 * 2^0
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000); // 1000 * 2^1
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 4000); // 1000 * 2^2
      expect(sleepSpy).toHaveBeenNthCalledWith(4, 8000); // 1000 * 2^3

      sleepSpy.mockRestore();
    });

    it('should cap delays at maxDelayMs', async () => {
      const sleepSpy = jest.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

      provider.generateFn = async () => {
        throw new Error('503 Service Unavailable');
      };

      await expect(
        provider.generate({
          prompt: 'test',
          retry: { maxRetries: 4, delayMs: 1000, backoffMultiplier: 2.0, maxDelayMs: 3000, jitter: false },
        })
      ).rejects.toThrow('503');

      // Delays: 1000, 2000, 3000 (capped), 3000 (capped)
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 3000);
      expect(sleepSpy).toHaveBeenNthCalledWith(4, 3000);

      sleepSpy.mockRestore();
    });

    it('should apply jitter (delays between 0 and computed max)', async () => {
      const sleepSpy = jest.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

      provider.generateFn = async () => {
        throw new Error('429 Rate limit');
      };

      await expect(
        provider.generate({
          prompt: 'test',
          retry: { maxRetries: 3, delayMs: 1000, backoffMultiplier: 2.0, maxDelayMs: 30000, jitter: true },
        })
      ).rejects.toThrow('429 Rate limit');

      expect(sleepSpy).toHaveBeenCalledTimes(3);

      // With jitter, each delay should be between 0 and the exponential max
      const delays = sleepSpy.mock.calls.map((call) => call[0] as number);
      expect(delays[0]).toBeGreaterThanOrEqual(0);
      expect(delays[0]).toBeLessThanOrEqual(1000);  // max: 1000 * 2^0
      expect(delays[1]).toBeGreaterThanOrEqual(0);
      expect(delays[1]).toBeLessThanOrEqual(2000);  // max: 1000 * 2^1
      expect(delays[2]).toBeGreaterThanOrEqual(0);
      expect(delays[2]).toBeLessThanOrEqual(4000);  // max: 1000 * 2^2

      sleepSpy.mockRestore();
    });
  });
});

// ============================================================
// DRY MODE TESTS
// ============================================================

describe('Dry Mode', () => {
  let provider: TestTTIProvider;

  beforeEach(() => {
    provider = new TestTTIProvider();
  });

  describe('generate() with dry: true', () => {
    it('should not call the actual generation function', async () => {
      let generateCalled = false;
      provider.generateFn = async () => {
        generateCalled = true;
        return {
          images: [{ base64: 'real-data' }],
          metadata: { provider: 'test', model: 'test-model', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test-model' },
        };
      };

      await provider.generate({ prompt: 'test prompt', dry: true });

      expect(generateCalled).toBe(false);
    });

    it('should return placeholder image', async () => {
      const result = await provider.generate({ prompt: 'test prompt', dry: true });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].base64).toBeDefined();
      expect(result.images[0].contentType).toBe('image/png');
    });

    it('should return metadata with provider and model', async () => {
      const result = await provider.generate({ prompt: 'test prompt', dry: true });

      expect(result.metadata.provider).toBe(TTIProvider.GOOGLE_CLOUD);
      expect(result.metadata.model).toBe('test-model');
      expect(result.metadata.duration).toBe(0);
    });

    it('should return usage with correct images count', async () => {
      const result = await provider.generate({ prompt: 'test prompt', dry: true });

      expect(result.usage.imagesGenerated).toBe(1);
      expect(result.usage.modelId).toBe('test-model');
    });

    it('should respect n parameter for multiple images', async () => {
      const result = await provider.generate({ prompt: 'test prompt', n: 3, dry: true });

      expect(result.images).toHaveLength(3);
      expect(result.usage.imagesGenerated).toBe(3);
      result.images.forEach((img) => {
        expect(img.base64).toBeDefined();
        expect(img.contentType).toBe('image/png');
      });
    });

    it('should use specified model in dry mode response', async () => {
      const result = await provider.generate({
        prompt: 'test prompt',
        model: 'test-model-cc',
        dry: true,
      });

      expect(result.metadata.model).toBe('test-model-cc');
      expect(result.usage.modelId).toBe('test-model-cc');
    });

    it('should still validate the request in dry mode', async () => {
      await expect(
        provider.generate({ prompt: '', dry: true })
      ).rejects.toThrow(InvalidConfigError);
    });

    it('should validate model capabilities in dry mode', async () => {
      await expect(
        provider.generate({
          prompt: 'test',
          model: 'test-model', // Does not support character consistency
          referenceImages: [{ base64: 'data' }],
          dry: true,
        })
      ).rejects.toThrow(CapabilityNotSupportedError);
    });

    it('should work with referenceImages on supporting model in dry mode', async () => {
      const result = await provider.generate({
        prompt: 'test with reference',
        model: 'test-model-cc',
        referenceImages: [{ base64: 'ref-data' }],
        subjectDescription: 'test subject',
        dry: true,
      });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].contentType).toBe('image/png');
      expect(result.metadata.model).toBe('test-model-cc');
    });
  });

  describe('generate() with dry: false or undefined', () => {
    it('should call actual generation when dry is false', async () => {
      let generateCalled = false;
      provider.generateFn = async () => {
        generateCalled = true;
        return {
          images: [{ base64: 'real-data' }],
          metadata: { provider: 'test', model: 'test-model', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test-model' },
        };
      };

      await provider.generate({ prompt: 'test', dry: false });

      expect(generateCalled).toBe(true);
    });

    it('should call actual generation when dry is undefined', async () => {
      let generateCalled = false;
      provider.generateFn = async () => {
        generateCalled = true;
        return {
          images: [{ base64: 'real-data' }],
          metadata: { provider: 'test', model: 'test-model', duration: 100 },
          usage: { imagesGenerated: 1, modelId: 'test-model' },
        };
      };

      await provider.generate({ prompt: 'test' });

      expect(generateCalled).toBe(true);
    });

    it('should return actual images when not in dry mode', async () => {
      const result = await provider.generate({ prompt: 'test' });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].base64).toBe('test-image-data');
    });
  });
});
