/**
 * Manual test script for Imagen Capability Inpainting
 *
 * Creates a synthetic base image (solid gray) and a center-mask (white rectangle
 * in the middle), then calls the Vertex AI imagen-3.0-capability-001 endpoint
 * to paint a red apple into the masked area.
 *
 * Prerequisites:
 *   - GOOGLE_CLOUD_PROJECT set in .env
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing to service account JSON
 *   - Region that supports imagen-capability (e.g. europe-west4, us-central1)
 *
 * Usage:
 *   npx ts-node scripts/manual-test-inpainting.ts
 *
 * Output:
 *   output/inpainting_base_<timestamp>.png   — the synthetic base image
 *   output/inpainting_mask_<timestamp>.png   — the mask (white = edit area)
 *   output/inpainting_result_<timestamp>.png — the inpainted result
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

// ============================================================
// ENV LOADER
// ============================================================

function loadEnv() {
  try {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        if (line.startsWith('#') || line.trim() === '') return;
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
          if (!process.env[key]) process.env[key] = value;
        }
      });
      console.log('.env loaded.');
    }
  } catch {
    // ignore
  }
}

// ============================================================
// MINIMAL PNG GENERATOR (no external dependencies)
// ============================================================

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function makePNG(
  width: number,
  height: number,
  getPixel: (x: number, y: number) => [number, number, number]
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);  // 8-bit depth
  ihdrData.writeUInt8(2, 9);  // RGB color type

  const raw = Buffer.alloc((1 + width * 3) * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y);
      raw[i++] = r; raw[i++] = g; raw[i++] = b;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function solidColorPNG(w: number, h: number, r: number, g: number, b: number): Buffer {
  return makePNG(w, h, () => [r, g, b]);
}

function centerMaskPNG(
  w: number,
  h: number,
  maskWidthRatio = 0.35,
  maskHeightRatio = 0.35
): Buffer {
  const x0 = Math.floor(w * (0.5 - maskWidthRatio / 2));
  const x1 = Math.floor(w * (0.5 + maskWidthRatio / 2));
  const y0 = Math.floor(h * (0.5 - maskHeightRatio / 2));
  const y1 = Math.floor(h * (0.5 + maskHeightRatio / 2));

  return makePNG(w, h, (x, y) =>
    (x >= x0 && x < x1 && y >= y0 && y < y1) ? [255, 255, 255] : [0, 0, 0]
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  loadEnv();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!projectId || !credentials) {
    console.error('❌ Missing configuration.\n');
    console.error('Required:');
    console.error('  GOOGLE_CLOUD_PROJECT=your-project-id');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=./vertex-ai-service-account.json');
    process.exit(1);
  }

  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const ts = Date.now();
  const IMG_SIZE = 512;

  // -- Generate and save base image (light gray 512x512) --
  console.log('\n📐 Generating test images...');
  const basePNG = solidColorPNG(IMG_SIZE, IMG_SIZE, 220, 220, 220);
  const maskPNG = centerMaskPNG(IMG_SIZE, IMG_SIZE, 0.35, 0.35);

  const basePath = path.join(outputDir, `inpainting_base_${ts}.png`);
  const maskPath = path.join(outputDir, `inpainting_mask_${ts}.png`);
  fs.writeFileSync(basePath, basePNG);
  fs.writeFileSync(maskPath, maskPNG);
  console.log(`   Base image saved: ${basePath}`);
  console.log(`   Mask saved:       ${maskPath}`);
  console.log(`   Base: ${IMG_SIZE}x${IMG_SIZE} solid light-gray`);
  console.log(`   Mask: ${IMG_SIZE}x${IMG_SIZE} black background, white ~35% center rectangle`);

  // -- Set up provider and service --
  const region = (process.env.GOOGLE_CLOUD_REGION || 'europe-west4') as 'europe-west4';
  console.log(`\n☁️  Provider: Google Cloud`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Region:  ${region}`);

  const provider = new GoogleCloudTTIProvider({ projectId, region });
  const service = new TTIService();
  service.registerProvider(provider);

  // -- Run the inpainting request --
  const prompt = 'A bright red apple with a green leaf, photorealistic, high quality, centered on the canvas';
  console.log(`\n🎨 Sending inpainting request...`);
  console.log(`   Model:     imagen-capability`);
  console.log(`   Edit mode: inpainting-insert`);
  console.log(`   Prompt:    "${prompt}"`);
  console.log(`   Dilation:  0.02`);

  const startTime = Date.now();

  try {
    const response = await service.generate({
      model: 'imagen-capability',
      prompt,
      baseImage: {
        base64: basePNG.toString('base64'),
        mimeType: 'image/png',
      },
      maskImage: {
        base64: maskPNG.toString('base64'),
        mimeType: 'image/png',
      },
      editMode: 'inpainting-insert',
      maskDilation: 0.02,
      retry: {
        maxRetries: 2,
        delayMs: 3000,
        timeoutMs: 120000,
      },
    });

    const duration = Date.now() - startTime;

    console.log(`\n✅ Success!`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Provider: ${response.metadata.provider}`);
    console.log(`   Model:    ${response.metadata.model}`);
    console.log(`   Region:   ${response.metadata.region || 'N/A'}`);
    console.log(`   Images:   ${response.usage.imagesGenerated}`);

    response.images.forEach((img, index) => {
      if (img.base64) {
        const resultPath = path.join(outputDir, `inpainting_result_${ts}_${index}.png`);
        fs.writeFileSync(resultPath, Buffer.from(img.base64, 'base64'));
        console.log(`   Result saved: ${resultPath}`);
      }
    });

    console.log('\n🔍 Review the three files in output/:');
    console.log(`   1. inpainting_base_${ts}.png   — light gray input`);
    console.log(`   2. inpainting_mask_${ts}.png   — white center = edit zone`);
    console.log(`   3. inpainting_result_${ts}_0.png — should show the apple in the center`);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n❌ Failed after ${duration}ms:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if ('cause' in error && error.cause instanceof Error) {
        console.error(`   Cause: ${error.cause.message}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
