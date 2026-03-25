/**
 * Manual test script for Imagen Capability — Mask Reference Images
 *
 * Autonomous two-step test — no external dependencies, no pre-existing images needed:
 *
 *   Step 1: Generate a subject image via text-to-image (gemini-flash-image = Gemini 2.5 Flash Image)
 *           "a young woman with short red hair, blue jacket, white background"
 *
 *   Step 2: Use that generated image as maskReferenceImage in an inpainting request.
 *           The model should insert the same person into the masked area of a
 *           neutral gray scene.
 *
 * If the feature works, the inpainted result should show a person visually
 * consistent with the Step 1 reference — same hair color, same jacket, same face.
 *
 * Prerequisites:
 *   - GOOGLE_CLOUD_PROJECT set in .env
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing to service account JSON
 *   - Region that supports both imagen-3 and imagen-capability (e.g. europe-west4)
 *
 * Usage:
 *   npx ts-node scripts/manual-test-mask-reference-images.ts
 *
 * Output:
 *   output/maskref_subject_<ts>.png      — Step 1: generated subject (reference)
 *   output/maskref_base_<ts>.png         — Step 2 input: neutral gray base scene
 *   output/maskref_mask_<ts>.png         — Step 2 input: portrait-sized mask
 *   output/maskref_result_<ts>_0.png     — Step 2 result: should show same person
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

function centerMaskPNG(w: number, h: number, widthRatio = 0.4, heightRatio = 0.6): Buffer {
  const x0 = Math.floor(w * (0.5 - widthRatio / 2));
  const x1 = Math.floor(w * (0.5 + widthRatio / 2));
  const y0 = Math.floor(h * (0.5 - heightRatio / 2));
  const y1 = Math.floor(h * (0.5 + heightRatio / 2));
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

  const region = (process.env.GOOGLE_CLOUD_REGION || 'europe-west4') as 'europe-west4';
  console.log(`\n☁️  Provider: Google Cloud  |  Project: ${projectId}  |  Region: ${region}`);

  const provider = new GoogleCloudTTIProvider({ projectId, region });
  const service = new TTIService();
  service.registerProvider(provider);

  const retry = { maxRetries: 2, delayMs: 3000, timeoutMs: 120000 };

  // ============================================================
  // STEP 1: Generate subject via text-to-image
  // ============================================================

  const subjectPrompt = 'a young woman with short red hair, blue jacket, plain white background, photorealistic, full body portrait, studio lighting';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Generate subject via text-to-image (gemini-flash-image / Gemini 2.5 Flash)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Prompt: "${subjectPrompt}"`);

  let subjectBase64: string;

  const t1 = Date.now();
  try {
    const subjectResponse = await service.generate({
      model: 'gemini-flash-image',
      prompt: subjectPrompt,
      n: 1,
      aspectRatio: '1:1',
      retry,
    });

    const subjectImage = subjectResponse.images[0];
    if (!subjectImage.base64) throw new Error('No base64 data in subject response');
    subjectBase64 = subjectImage.base64;

    const subjectPath = path.join(outputDir, `maskref_subject_${ts}.png`);
    fs.writeFileSync(subjectPath, Buffer.from(subjectBase64, 'base64'));

    console.log(`\n✅ Subject generated in ${Date.now() - t1}ms`);
    console.log(`   Saved: ${subjectPath}`);
  } catch (error) {
    console.error(`\n❌ Step 1 failed after ${Date.now() - t1}ms:`);
    if (error instanceof Error) console.error(`   ${error.message}`);
    process.exit(1);
  }

  // ============================================================
  // STEP 2: Inpaint that subject into a masked scene
  // ============================================================

  const inpaintPrompt = 'the same woman standing in a bright sunny park, photorealistic, natural lighting, full body visible';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Inpaint subject into masked scene (imagen-capability)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Prompt: "${inpaintPrompt}"`);
  console.log(`   Subject type: person`);

  // Neutral gray base scene + portrait-sized center mask
  const basePNG = solidColorPNG(IMG_SIZE, IMG_SIZE, 200, 200, 200);
  const maskPNG = centerMaskPNG(IMG_SIZE, IMG_SIZE, 0.4, 0.6);

  const basePath = path.join(outputDir, `maskref_base_${ts}.png`);
  const maskPath = path.join(outputDir, `maskref_mask_${ts}.png`);
  fs.writeFileSync(basePath, basePNG);
  fs.writeFileSync(maskPath, maskPNG);
  console.log(`   Base saved: ${basePath}`);
  console.log(`   Mask saved: ${maskPath}`);

  const t2 = Date.now();
  try {
    const inpaintResponse = await service.generate({
      model: 'imagen-capability',
      prompt: inpaintPrompt,
      baseImage: { base64: basePNG.toString('base64'), mimeType: 'image/png' },
      maskImage: { base64: maskPNG.toString('base64'), mimeType: 'image/png' },
      editMode: 'inpainting-insert',
      maskDilation: 0.02,
      maskReferenceImages: [
        {
          base64: subjectBase64,
          mimeType: 'image/png',
          subjectType: 'person',
        },
      ],
      retry,
    });

    console.log(`\n✅ Inpainting done in ${Date.now() - t2}ms`);

    inpaintResponse.images.forEach((img, idx) => {
      if (img.base64) {
        const resultPath = path.join(outputDir, `maskref_result_${ts}_${idx}.png`);
        fs.writeFileSync(resultPath, Buffer.from(img.base64, 'base64'));
        console.log(`   Result saved: ${resultPath}`);
      }
    });

    console.log('\n🔍 Compare these two files to verify subject consistency:');
    console.log(`   REFERENCE → output/maskref_subject_${ts}.png`);
    console.log(`   RESULT    → output/maskref_result_${ts}_0.png`);
    console.log('\n   The result should show the same woman (red hair, blue jacket)');
    console.log('   placed into a sunny park scene.');

  } catch (error) {
    console.error(`\n❌ Step 2 failed after ${Date.now() - t2}ms:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if ('cause' in error && error.cause instanceof Error) {
        console.error(`   Cause: ${error.cause.message}`);
      }
    }
    console.error('\n💡 If the error is "REFERENCE_TYPE_SUBJECT not supported",');
    console.error('   this editMode + model combination may not support subject refs.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
