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

  async generate(request: TTIRequest): Promise<TTIResponse> {
    this.validateRequest(request);
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

  public testResolveRetryConfig(request: TTIRequest) {
    return this.resolveRetryConfig(request);
  }

  public testCalculateRetryDelay(attempt: number, config: Required<typeof DEFAULT_RETRY_OPTIONS>) {
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

    it('should throw when referenceImages provided without subjectDescription', () => {
      expect(() => {
        provider.testValidateRequest({
          prompt: 'test',
          model: 'test-model-cc',
          referenceImages: [{ base64: 'data' }],
          // Missing subjectDescription
        });
      }).toThrow(InvalidConfigError);
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

  describe('isRateLimitError()', () => {
    it('should detect 429 errors', () => {
      expect(provider.testIsRateLimitError(new Error('status 429'))).toBe(true);
    });

    it('should detect rate limit messages', () => {
      expect(provider.testIsRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    });

    it('should detect quota exceeded messages', () => {
      expect(provider.testIsRateLimitError(new Error('Quota exceeded'))).toBe(true);
    });

    it('should detect too many requests messages', () => {
      expect(provider.testIsRateLimitError(new Error('Too many requests'))).toBe(true);
    });

    it('should detect resource exhausted messages', () => {
      expect(provider.testIsRateLimitError(new Error('Resource exhausted'))).toBe(true);
    });

    it('should not flag other errors', () => {
      expect(provider.testIsRateLimitError(new Error('Connection failed'))).toBe(false);
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
      expect(config?.incrementalBackoff).toBe(DEFAULT_RETRY_OPTIONS.incrementalBackoff);
    });

    it('should handle all custom options', () => {
      const config = provider.testResolveRetryConfig({
        prompt: 'test',
        retry: { maxRetries: 3, delayMs: 2000, incrementalBackoff: true },
      });
      expect(config).toEqual({ maxRetries: 3, delayMs: 2000, incrementalBackoff: true });
    });
  });

  describe('calculateRetryDelay()', () => {
    it('should return static delay when incrementalBackoff is false', () => {
      const config = { maxRetries: 2, delayMs: 1000, incrementalBackoff: false };
      expect(provider.testCalculateRetryDelay(1, config)).toBe(1000);
      expect(provider.testCalculateRetryDelay(2, config)).toBe(1000);
      expect(provider.testCalculateRetryDelay(3, config)).toBe(1000);
    });

    it('should return incremental delay when incrementalBackoff is true', () => {
      const config = { maxRetries: 2, delayMs: 1000, incrementalBackoff: true };
      expect(provider.testCalculateRetryDelay(1, config)).toBe(1000); // 1 * 1000
      expect(provider.testCalculateRetryDelay(2, config)).toBe(2000); // 2 * 1000
      expect(provider.testCalculateRetryDelay(3, config)).toBe(3000); // 3 * 1000
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

    it('should not retry on non-rate-limit errors', async () => {
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
        provider.generate({ prompt: 'test', retry: { maxRetries: 2, delayMs: 10 } })
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
  });
});
