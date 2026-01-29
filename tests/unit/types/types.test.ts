/**
 * Unit Tests for Type Definitions
 *
 * Tests the exported types and constants.
 */

import {
  TTIProvider,
  DEFAULT_RETRY_OPTIONS,
  TTIRequest,
  TTIResponse,
  ModelInfo,
  TTICapabilities,
  TTIUsage,
  RetryOptions,
} from '../../../src/middleware/types';

// ============================================================
// TESTS
// ============================================================

describe('TTIProvider enum', () => {
  it('should have correct values', () => {
    expect(TTIProvider.GOOGLE_CLOUD).toBe('google-cloud');
    expect(TTIProvider.EDENAI).toBe('edenai');
    expect(TTIProvider.IONOS).toBe('ionos');
  });

  it('should have exactly 3 providers', () => {
    const providers = Object.values(TTIProvider);
    expect(providers).toHaveLength(3);
  });
});

describe('DEFAULT_RETRY_OPTIONS', () => {
  it('should have maxRetries of 3', () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(3);
  });

  it('should have delayMs of 1000', () => {
    expect(DEFAULT_RETRY_OPTIONS.delayMs).toBe(1000);
  });

  it('should have backoffMultiplier of 2.0', () => {
    expect(DEFAULT_RETRY_OPTIONS.backoffMultiplier).toBe(2.0);
  });

  it('should have maxDelayMs of 30000', () => {
    expect(DEFAULT_RETRY_OPTIONS.maxDelayMs).toBe(30000);
  });

  it('should have jitter enabled by default', () => {
    expect(DEFAULT_RETRY_OPTIONS.jitter).toBe(true);
  });

  it('should be a complete RetryOptions object (without deprecated fields)', () => {
    const required: Required<Omit<RetryOptions, 'incrementalBackoff'>> = DEFAULT_RETRY_OPTIONS;
    expect(required).toBeDefined();
  });
});

describe('Type exports', () => {
  // These are compile-time checks - if they don't compile, the test fails

  it('should export TTIRequest type', () => {
    const request: TTIRequest = {
      prompt: 'test prompt',
      model: 'test-model',
      n: 1,
      aspectRatio: '1:1',
      retry: true,
    };
    expect(request.prompt).toBe('test prompt');
  });

  it('should export TTIRequest with referenceImages', () => {
    const request: TTIRequest = {
      prompt: 'test prompt',
      referenceImages: [
        { base64: 'data', mimeType: 'image/png' },
      ],
      subjectDescription: 'test subject',
    };
    expect(request.referenceImages).toHaveLength(1);
  });

  it('should export TTIRequest with retry options', () => {
    const request: TTIRequest = {
      prompt: 'test',
      retry: {
        maxRetries: 5,
        delayMs: 2000,
        backoffMultiplier: 3.0,
        maxDelayMs: 60000,
        jitter: false,
      },
    };
    expect((request.retry as RetryOptions).maxRetries).toBe(5);
  });

  it('should export TTIRequest with deprecated incrementalBackoff', () => {
    const request: TTIRequest = {
      prompt: 'test',
      retry: {
        incrementalBackoff: true,
      },
    };
    expect((request.retry as RetryOptions).incrementalBackoff).toBe(true);
  });

  it('should export TTIResponse type', () => {
    const response: TTIResponse = {
      images: [{ base64: 'data', contentType: 'image/png' }],
      metadata: {
        provider: 'google-cloud',
        model: 'imagen-3',
        duration: 1000,
        region: 'europe-west4',
      },
      usage: {
        imagesGenerated: 1,
        modelId: 'imagen-3',
      },
    };
    expect(response.images).toHaveLength(1);
  });

  it('should export ModelInfo type', () => {
    const model: ModelInfo = {
      id: 'test-model',
      displayName: 'Test Model',
      capabilities: {
        textToImage: true,
        characterConsistency: false,
        imageEditing: false,
        maxImagesPerRequest: 4,
      },
      availableRegions: ['europe-west1'],
      pricingUrl: 'https://example.com/pricing',
    };
    expect(model.capabilities.textToImage).toBe(true);
  });

  it('should export TTICapabilities type', () => {
    const capabilities: TTICapabilities = {
      textToImage: true,
      characterConsistency: true,
      imageEditing: false,
      maxImagesPerRequest: 1,
    };
    expect(capabilities.characterConsistency).toBe(true);
  });

  it('should export TTIUsage type', () => {
    const usage: TTIUsage = {
      imagesGenerated: 2,
      modelId: 'test',
      imageSize: '1024x1024',
      inputTokens: 100,
      outputTokens: 50,
    };
    expect(usage.imagesGenerated).toBe(2);
  });
});
