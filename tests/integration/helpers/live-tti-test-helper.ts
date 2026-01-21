/**
 * Live TTI Test Helper
 *
 * Utilities for running integration tests against real image generation APIs.
 * Tests are skipped by default unless TTI_INTEGRATION_TESTS=true is set.
 *
 * Usage:
 *   TTI_INTEGRATION_TESTS=true npm run test:integration
 */

import { TTIRequest, TTIProvider, RetryOptions } from '../../../src/middleware/types';

// ============================================================
// ENVIRONMENT CONFIGURATION
// ============================================================

/**
 * Check if live integration tests should run
 */
export function shouldRunLiveTests(): boolean {
  return process.env.TTI_INTEGRATION_TESTS === 'true';
}

/**
 * Validate that all required environment variables are set
 */
export function validateLiveTTIEnvironment(): void {
  const required = [
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for live TTI tests: ${missing.join(', ')}\n` +
        'Set these in your .env file or export them before running tests.'
    );
  }
}

// ============================================================
// CONDITIONAL TEST EXECUTION
// ============================================================

/**
 * Conditional describe block - skips if live tests disabled
 */
export const describeLive = shouldRunLiveTests() ? describe : describe.skip;

/**
 * Conditional test block - skips if live tests disabled
 */
export const itLive = shouldRunLiveTests() ? it : it.skip;

// ============================================================
// TEST CONSTANTS
// ============================================================

/** Default timeout for image generation API calls (60 seconds) */
export const TTI_TIMEOUT = 60000;

/** Extended timeout for character consistency tests (120 seconds) */
export const TTI_EXTENDED_TIMEOUT = 120000;

/** Default test model */
export const TEST_MODEL = 'gemini-flash-image';

/** Default test provider */
export const TEST_PROVIDER = TTIProvider.GOOGLE_CLOUD;

/** Default retry configuration for tests */
export const TEST_RETRY_CONFIG: RetryOptions = {
  maxRetries: 2,
  delayMs: 2000,
  incrementalBackoff: true,
};

// ============================================================
// REQUEST BUILDERS
// ============================================================

export interface LiveTestRequestOptions {
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  n?: number;
  retry?: boolean | RetryOptions;
}

/**
 * Build a test request with sensible defaults
 */
export function buildLiveTestRequest(
  options: LiveTestRequestOptions = {}
): TTIRequest {
  return {
    prompt: options.prompt ?? 'A simple red circle on white background, minimal, flat design',
    model: options.model ?? TEST_MODEL,
    aspectRatio: options.aspectRatio ?? '1:1',
    n: options.n ?? 1,
    retry: options.retry ?? TEST_RETRY_CONFIG,
  };
}

export interface CharacterConsistencyTestOptions extends LiveTestRequestOptions {
  referenceBase64: string;
  referenceMimeType?: string;
  subjectDescription: string;
}

/**
 * Build a character consistency test request
 */
export function buildCharacterConsistencyRequest(
  options: CharacterConsistencyTestOptions
): TTIRequest {
  return {
    prompt: options.prompt ?? 'standing in a forest clearing',
    model: options.model ?? 'gemini-flash-image',
    aspectRatio: options.aspectRatio ?? '1:1',
    n: options.n ?? 1,
    retry: options.retry ?? TEST_RETRY_CONFIG,
    referenceImages: [
      {
        base64: options.referenceBase64,
        mimeType: options.referenceMimeType ?? 'image/png',
      },
    ],
    subjectDescription: options.subjectDescription,
  };
}

// ============================================================
// LOGGING UTILITIES
// ============================================================

/**
 * Log the start of a live test
 */
export function logLiveTestStart(testName: string): void {
  console.log(`\n[LIVE TEST] Starting: ${testName}`);
  console.log(`[LIVE TEST] Time: ${new Date().toISOString()}`);
}

/**
 * Log the result of a live test
 */
export function logLiveTestResult(result: {
  model?: string;
  region?: string;
  duration?: number;
  imagesGenerated?: number;
  error?: string;
}): void {
  if (result.error) {
    console.log(`[LIVE TEST] ❌ Error: ${result.error}`);
    return;
  }

  console.log('[LIVE TEST] ✅ Success');
  if (result.model) console.log(`[LIVE TEST]   Model: ${result.model}`);
  if (result.region) console.log(`[LIVE TEST]   Region: ${result.region}`);
  if (result.duration) console.log(`[LIVE TEST]   Duration: ${result.duration}ms`);
  if (result.imagesGenerated) console.log(`[LIVE TEST]   Images: ${result.imagesGenerated}`);
}

// ============================================================
// VALIDATION UTILITIES
// ============================================================

/**
 * Validate that a response contains valid image data
 */
export function validateImageResponse(response: {
  images?: Array<{ base64?: string; url?: string }>;
}): boolean {
  if (!response.images || response.images.length === 0) {
    return false;
  }

  return response.images.every((img) => {
    return (img.base64 && img.base64.length > 0) || (img.url && img.url.length > 0);
  });
}

/**
 * Check if base64 string is a valid image
 * (Basic check - just verifies it's a non-empty base64 string)
 */
export function isValidBase64Image(base64: string): boolean {
  if (!base64 || base64.length === 0) return false;

  // Check for common image magic bytes in base64
  // PNG starts with iVBORw0KGgo
  // JPEG starts with /9j/
  const isPNG = base64.startsWith('iVBORw0KGgo');
  const isJPEG = base64.startsWith('/9j/');

  return isPNG || isJPEG || base64.length > 1000; // Fallback: at least 1KB of data
}
