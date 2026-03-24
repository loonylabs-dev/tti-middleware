/**
 * Live TTI Test Helper
 *
 * Utilities for running integration tests against real image generation APIs.
 * Tests are skipped by default unless TTI_INTEGRATION_TESTS=true is set.
 *
 * Usage:
 *   TTI_INTEGRATION_TESTS=true npm run test:integration
 */

import * as zlib from 'zlib';
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

// ============================================================
// PNG GENERATION UTILITIES (for inpainting tests)
// ============================================================

/**
 * Create a chunk for a PNG file
 */
function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);

  // CRC32 over type + data
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  crc ^= 0xffffffff;

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, body, crcBuffer]);
}

/**
 * Generate a minimal PNG from raw RGB pixel data.
 * @param width  Image width in pixels
 * @param height Image height in pixels
 * @param getPixel Returns [r, g, b] for each (x, y)
 */
export function generatePNG(
  width: number,
  height: number,
  getPixel: (x: number, y: number) => [number, number, number]
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);  // bit depth
  ihdrData.writeUInt8(2, 9);  // color type: RGB
  // compression, filter, interlace all 0
  const ihdr = createPNGChunk('IHDR', ihdrData);

  // Raw scanlines: filter byte (0) + RGB pixels per row
  const rawRows = Buffer.alloc((1 + width * 3) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawRows[offset++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y);
      rawRows[offset++] = r;
      rawRows[offset++] = g;
      rawRows[offset++] = b;
    }
  }

  const compressed = zlib.deflateSync(rawRows);
  const idat = createPNGChunk('IDAT', compressed);
  const iend = createPNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * Create a solid-color PNG as base64
 */
export function createSolidColorPNG(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): string {
  return generatePNG(width, height, () => [r, g, b]).toString('base64');
}

/**
 * Create a mask PNG (black background, white rectangle in center) as base64.
 * White = area to inpaint, black = area to preserve.
 */
export function createCenterMaskPNG(
  width: number,
  height: number,
  maskWidthRatio = 0.3,
  maskHeightRatio = 0.3
): string {
  const maskX0 = Math.floor(width * (0.5 - maskWidthRatio / 2));
  const maskX1 = Math.floor(width * (0.5 + maskWidthRatio / 2));
  const maskY0 = Math.floor(height * (0.5 - maskHeightRatio / 2));
  const maskY1 = Math.floor(height * (0.5 + maskHeightRatio / 2));

  return generatePNG(width, height, (x, y) => {
    const inMask = x >= maskX0 && x < maskX1 && y >= maskY0 && y < maskY1;
    return inMask ? [255, 255, 255] : [0, 0, 0];
  }).toString('base64');
}

export interface InpaintingTestOptions extends LiveTestRequestOptions {
  baseImageBase64: string;
  baseImageMimeType?: string;
  maskBase64: string;
  maskMimeType?: string;
  editMode?: 'inpainting-insert' | 'inpainting-remove' | 'background-swap' | 'outpainting';
  maskDilation?: number;
}

/**
 * Build an inpainting test request
 */
export function buildInpaintingRequest(options: InpaintingTestOptions): TTIRequest {
  return {
    prompt: options.prompt ?? 'A bright red apple',
    model: options.model ?? 'imagen-capability',
    n: options.n ?? 1,
    retry: options.retry ?? TEST_RETRY_CONFIG,
    baseImage: {
      base64: options.baseImageBase64,
      mimeType: options.baseImageMimeType ?? 'image/png',
    },
    maskImage: {
      base64: options.maskBase64,
      mimeType: options.maskMimeType ?? 'image/png',
    },
    editMode: options.editMode ?? 'inpainting-insert',
    maskDilation: options.maskDilation ?? 0.02,
  };
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
