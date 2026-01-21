/**
 * Integration Tests for Google Cloud TTI Provider
 *
 * These tests make REAL API calls and generate actual images.
 * They are skipped by default unless TTI_INTEGRATION_TESTS=true is set.
 *
 * Prerequisites:
 *   - GOOGLE_CLOUD_PROJECT set in environment
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing to service account JSON
 *   - TTI_INTEGRATION_TESTS=true to enable tests
 *
 * Usage:
 *   TTI_INTEGRATION_TESTS=true npm run test:integration
 *
 * Note: These tests incur API costs and take 10-30 seconds each.
 */

import { TTIService } from '../../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../../src/middleware/services/tti/providers/google-cloud-provider';
import { TTIProvider } from '../../src/middleware/types';
import {
  describeLive,
  itLive,
  validateLiveTTIEnvironment,
  buildLiveTestRequest,
  buildCharacterConsistencyRequest,
  logLiveTestStart,
  logLiveTestResult,
  validateImageResponse,
  isValidBase64Image,
  TTI_TIMEOUT,
  TTI_EXTENDED_TIMEOUT,
} from './helpers/live-tti-test-helper';

// ============================================================
// TEST SETUP
// ============================================================

describeLive('Google Cloud TTI Provider - Integration Tests', () => {
  let service: TTIService;
  let provider: GoogleCloudTTIProvider;

  beforeAll(() => {
    // Validate environment before running any tests
    validateLiveTTIEnvironment();

    // Initialize service and provider
    provider = new GoogleCloudTTIProvider();
    service = new TTIService();
    service.registerProvider(provider);

    console.log('\n========================================');
    console.log('Google Cloud TTI Integration Tests');
    console.log('========================================');
    console.log(`Project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
    console.log(`Region: ${provider.getRegion()}`);
    console.log(`EU Region: ${provider.isEURegion()}`);
    console.log('========================================\n');
  });

  // ============================================================
  // IMAGEN 3 TESTS
  // ============================================================

  describe('Imagen 3', () => {
    itLive(
      'should generate a simple image',
      async () => {
        logLiveTestStart('Imagen 3 - Simple Image');

        const request = buildLiveTestRequest({
          prompt: 'A simple red apple on a white background, minimalist, clean',
          model: 'imagen-3',
        });

        const response = await service.generate(request);

        // Validate response structure
        expect(response).toBeDefined();
        expect(response.images).toBeDefined();
        expect(response.images.length).toBeGreaterThan(0);
        expect(response.metadata.provider).toBe(TTIProvider.GOOGLE_CLOUD);
        expect(response.metadata.model).toBe('imagen-3');
        expect(response.metadata.duration).toBeGreaterThan(0);
        expect(response.usage.imagesGenerated).toBe(1);

        // Validate image data
        expect(validateImageResponse(response)).toBe(true);
        const image = response.images[0];
        expect(image.base64).toBeDefined();
        expect(isValidBase64Image(image.base64!)).toBe(true);

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });
      },
      TTI_TIMEOUT
    );

    itLive(
      'should generate image with 16:9 aspect ratio',
      async () => {
        logLiveTestStart('Imagen 3 - 16:9 Aspect Ratio');

        const request = buildLiveTestRequest({
          prompt: 'A panoramic mountain landscape at sunset, cinematic',
          model: 'imagen-3',
          aspectRatio: '16:9',
        });

        const response = await service.generate(request);

        expect(response.images.length).toBe(1);
        expect(validateImageResponse(response)).toBe(true);

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });
      },
      TTI_TIMEOUT
    );
  });

  // ============================================================
  // GEMINI FLASH IMAGE TESTS
  // ============================================================

  describe('Gemini Flash Image', () => {
    itLive(
      'should generate a simple image',
      async () => {
        logLiveTestStart('Gemini Flash - Simple Image');

        const request = buildLiveTestRequest({
          prompt: 'A cute cartoon cat sitting on a cushion, digital art style',
          model: 'gemini-flash-image',
        });

        const response = await service.generate(request);

        expect(response).toBeDefined();
        expect(response.images.length).toBeGreaterThan(0);
        expect(response.metadata.model).toBe('gemini-flash-image');
        expect(validateImageResponse(response)).toBe(true);

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });
      },
      TTI_TIMEOUT
    );

    itLive(
      'should handle region fallback for europe-west3',
      async () => {
        logLiveTestStart('Gemini Flash - Region Fallback');

        // Create provider with europe-west3 (where Gemini is NOT available)
        const frankfurtProvider = new GoogleCloudTTIProvider({
          projectId: process.env.GOOGLE_CLOUD_PROJECT!,
          region: 'europe-west3',
        });

        const frankfurtService = new TTIService();
        frankfurtService.registerProvider(frankfurtProvider);

        const request = buildLiveTestRequest({
          prompt: 'A simple blue square, minimal',
          model: 'gemini-flash-image',
        });

        const response = await frankfurtService.generate(request);

        // Should succeed with fallback region (NOT europe-west3)
        expect(response).toBeDefined();
        expect(response.metadata.region).not.toBe('europe-west3');
        expect(validateImageResponse(response)).toBe(true);

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });

        console.log(`[LIVE TEST] ✓ Fallback from europe-west3 to ${response.metadata.region}`);
      },
      TTI_TIMEOUT
    );
  });

  // ============================================================
  // CHARACTER CONSISTENCY TESTS
  // ============================================================

  describe('Character Consistency', () => {
    let referenceImageBase64: string;

    itLive(
      'should create a reference character',
      async () => {
        logLiveTestStart('Character Consistency - Create Reference');

        const request = buildLiveTestRequest({
          prompt:
            'A cute cartoon bear wearing a red hat and blue scarf, standing pose, children book illustration style, watercolor, white background',
          model: 'gemini-flash-image',
        });

        const response = await service.generate(request);

        expect(response.images.length).toBe(1);
        expect(response.images[0].base64).toBeDefined();

        // Save for next test
        referenceImageBase64 = response.images[0].base64!;

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });

        console.log(`[LIVE TEST] ✓ Reference image saved (${referenceImageBase64.length} bytes)`);
      },
      TTI_TIMEOUT
    );

    itLive(
      'should generate consistent character in new scene',
      async () => {
        // Skip if no reference image from previous test
        if (!referenceImageBase64) {
          console.log('[LIVE TEST] ⚠ Skipping - no reference image available');
          return;
        }

        logLiveTestStart('Character Consistency - New Scene');

        const request = buildCharacterConsistencyRequest({
          prompt: 'dancing happily in a forest clearing, joyful expression',
          referenceBase64: referenceImageBase64,
          subjectDescription: 'cute cartoon bear with red hat and blue scarf',
        });

        const response = await service.generate(request);

        expect(response.images.length).toBe(1);
        expect(validateImageResponse(response)).toBe(true);

        logLiveTestResult({
          model: response.metadata.model,
          region: response.metadata.region,
          duration: response.metadata.duration,
          imagesGenerated: response.usage.imagesGenerated,
        });

        console.log('[LIVE TEST] ✓ Character consistency image generated');
        console.log('[LIVE TEST] ⚡ Manual verification required to confirm character match');
      },
      TTI_EXTENDED_TIMEOUT
    );
  });

  // ============================================================
  // RETRY LOGIC TESTS
  // ============================================================

  describe('Retry Logic', () => {
    itLive(
      'should handle rate limits with retry',
      async () => {
        logLiveTestStart('Retry Logic - Multiple Requests');

        // Make multiple quick requests to potentially trigger rate limiting
        const requests = [
          buildLiveTestRequest({
            prompt: 'A red circle',
            model: 'gemini-flash-image',
            retry: { maxRetries: 3, delayMs: 2000, incrementalBackoff: true },
          }),
          buildLiveTestRequest({
            prompt: 'A blue square',
            model: 'gemini-flash-image',
            retry: { maxRetries: 3, delayMs: 2000, incrementalBackoff: true },
          }),
        ];

        const results = [];
        for (const request of requests) {
          const response = await service.generate(request);
          results.push(response);
        }

        // Both should succeed (either immediately or after retry)
        expect(results.length).toBe(2);
        expect(results.every((r) => validateImageResponse(r))).toBe(true);

        console.log('[LIVE TEST] ✓ Both requests completed successfully');
        for (const result of results) {
          logLiveTestResult({
            model: result.metadata.model,
            duration: result.metadata.duration,
            imagesGenerated: result.usage.imagesGenerated,
          });
        }
      },
      TTI_EXTENDED_TIMEOUT
    );
  });

});

// ============================================================
// SKIP MESSAGE
// ============================================================

if (process.env.TTI_INTEGRATION_TESTS !== 'true') {
  describe('Google Cloud TTI Integration Tests', () => {
    it('SKIPPED - Set TTI_INTEGRATION_TESTS=true to run', () => {
      console.log('\n');
      console.log('================================================');
      console.log('  Integration tests are SKIPPED by default');
      console.log('');
      console.log('  To run integration tests:');
      console.log('    TTI_INTEGRATION_TESTS=true npm run test:integration');
      console.log('');
      console.log('  Prerequisites:');
      console.log('    - GOOGLE_CLOUD_PROJECT');
      console.log('    - GOOGLE_APPLICATION_CREDENTIALS');
      console.log('================================================');
      console.log('\n');
    });
  });
}
