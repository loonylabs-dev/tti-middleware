import * as fs from 'fs';
import * as path from 'path';
import { TTIRequest } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for new models: Imagen 4 & Gemini 3 Pro Image
 *
 * Tests the newly added models to verify they work end-to-end via Vertex AI.
 *
 * Prerequisites:
 *   - Set GOOGLE_CLOUD_PROJECT in .env
 *   - Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file
 *   - Optional: Set GOOGLE_CLOUD_REGION (default: europe-west4)
 *
 * Usage:
 *   npx ts-node scripts/manual-test-new-models.ts
 *   npx ts-node scripts/manual-test-new-models.ts --imagen4-only
 *   npx ts-node scripts/manual-test-new-models.ts --gemini-pro-only
 */

// Simple .env parser
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf8');
      envConfig.split('\n').forEach((line) => {
        if (line.startsWith('#') || line.trim() === '') return;

        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
      console.log('.env file loaded.');
    } else {
      console.warn('No .env file found. Using system environment variables.');
    }
  } catch (error) {
    console.error('Error loading .env:', error);
  }
}

async function runTest(
  testName: string,
  request: TTIRequest,
  service: TTIService
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log('='.repeat(60));
  console.log(`Prompt: "${request.prompt.substring(0, 100)}${request.prompt.length > 100 ? '...' : ''}"`);
  console.log(`Model: ${request.model || 'default'}`);
  if (request.aspectRatio) {
    console.log(`Aspect Ratio: ${request.aspectRatio}`);
  }

  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const startTime = Date.now();
    const response = await service.generate(request);
    const duration = Date.now() - startTime;

    console.log(`\n  Success!`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Provider: ${response.metadata.provider}`);
    console.log(`   Model: ${response.metadata.model}`);
    console.log(`   Region: ${response.metadata.region || 'N/A'}`);
    console.log(`   Images: ${response.usage.imagesGenerated}`);

    response.images.forEach((img, index) => {
      if (img.base64) {
        const fileName = `${request.model || 'default'}_${Date.now()}_${index}.png`;
        const outputPath = path.join(outputDir, fileName);
        fs.writeFileSync(outputPath, Buffer.from(img.base64, 'base64'));
        console.log(`   Saved: ${outputPath}`);
      } else if (img.url) {
        console.log(`   URL: ${img.url}`);
      }
    });

    return response;
  } catch (error) {
    console.error(`\n  Test '${testName}' Failed:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if ('code' in error) {
        console.error(`   Code: ${(error as { code: string }).code}`);
      }
    }
    return null;
  }
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const imagen4Only = args.includes('--imagen4-only');
  const geminiProOnly = args.includes('--gemini-pro-only');
  const runAll = !imagen4Only && !geminiProOnly;

  // Check configuration
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const region = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_AI_REGION || 'europe-west4';

  if (!projectId || !serviceAccountPath) {
    console.error('Error: Missing configuration.');
    console.error('');
    console.error('Required environment variables:');
    console.error('  GOOGLE_CLOUD_PROJECT=your-project-id');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account.json');
    console.error('');
    console.error('Optional:');
    console.error('  GOOGLE_CLOUD_REGION=europe-west4');
    process.exit(1);
  }

  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account file not found: ${serviceAccountPath}`);
    process.exit(1);
  }

  // Initialize
  const service = new TTIService();
  const provider = new GoogleCloudTTIProvider({
    projectId,
    region: region as 'europe-west4',
  });

  service.registerProvider(provider);

  // Show configuration
  console.log('\nConfiguration:');
  console.log(`   Project: ${projectId}`);
  console.log(`   Region: ${region}`);
  console.log(`   EU Region: ${provider.isEURegion() ? 'Yes' : 'No'}`);

  console.log('\nAvailable Models:');
  for (const model of provider.listModels()) {
    console.log(`   - ${model.id} (${model.displayName})`);
    console.log(`     Regions: ${model.availableRegions?.join(', ') || 'global (all regions)'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Starting new model tests...');
  console.log('='.repeat(60));

  // =====================================================
  // Imagen 4 Tests
  // =====================================================
  if (runAll || imagen4Only) {
    // Imagen 4 Standard
    await runTest('Imagen 4 - Photorealistic Landscape', {
      prompt: 'A breathtaking alpine landscape at golden hour, crystal clear mountain lake reflecting snow-capped peaks, wildflowers in foreground, photorealistic, 8k quality',
      model: 'imagen-4',
      aspectRatio: '16:9',
    }, service);

    // Imagen 4 - Text rendering test
    await runTest('Imagen 4 - Text in Image', {
      prompt: 'A vintage coffee shop sign that reads "The Daily Grind" in elegant hand-painted lettering, warm morning light, rustic wooden frame',
      model: 'imagen-4',
      aspectRatio: '4:3',
    }, service);

    // Imagen 4 Fast
    await runTest('Imagen 4 Fast - Quick Generation', {
      prompt: 'A colorful hot air balloon floating over lavender fields in Provence, blue sky with wispy clouds, aerial photography style',
      model: 'imagen-4-fast',
      aspectRatio: '1:1',
    }, service);

    // Imagen 4 Ultra
    await runTest('Imagen 4 Ultra - Maximum Quality', {
      prompt: 'A macro photograph of a dewdrop on a spider web at sunrise, intricate web patterns, bokeh background of a misty garden, extreme detail, professional macro photography',
      model: 'imagen-4-ultra',
      aspectRatio: '1:1',
    }, service);
  }

  // =====================================================
  // Gemini 3 Pro Image Tests
  // =====================================================
  if (runAll || geminiProOnly) {
    // Gemini Pro - Basic generation
    await runTest('Gemini 3 Pro Image - Illustration', {
      prompt: 'A whimsical treehouse village connected by rope bridges, lanterns glowing at dusk, children book illustration style, watercolor and ink, warm color palette',
      model: 'gemini-pro-image',
      aspectRatio: '16:9',
    }, service);

    // Gemini Pro - Text rendering (one of its strengths)
    await runTest('Gemini 3 Pro Image - Text Rendering', {
      prompt: 'A beautifully designed book cover for "The Secret Garden" with ornate botanical border illustrations, the title in elegant serif typography, soft green and gold color scheme',
      model: 'gemini-pro-image',
      aspectRatio: '3:4',
    }, service);

    // Gemini Pro - High detail
    await runTest('Gemini 3 Pro Image - Architectural Detail', {
      prompt: 'Interior of a modern Japanese tea house, minimalist zen design, natural materials, soft diffused light through shoji screens, wabi-sabi aesthetic, architectural photography',
      model: 'gemini-pro-image',
      aspectRatio: '16:9',
    }, service);
  }

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
  console.log('\nOutput images saved in ./output directory.');
  console.log('\nUsage:');
  console.log('  npx ts-node scripts/manual-test-new-models.ts              # All tests');
  console.log('  npx ts-node scripts/manual-test-new-models.ts --imagen4-only     # Imagen 4 only');
  console.log('  npx ts-node scripts/manual-test-new-models.ts --gemini-pro-only  # Gemini Pro only');
}

main().catch(console.error);
