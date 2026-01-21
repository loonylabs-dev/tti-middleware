import * as fs from 'fs';
import * as path from 'path';
import { TTIProvider, TTIRequest, DEFAULT_RETRY_OPTIONS } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for Google Cloud TTI Provider
 *
 * Tests both Imagen 3 and Gemini Flash Image models including character consistency.
 *
 * Retry Behavior (default):
 *   - Automatic retry on rate limits (429 errors)
 *   - Default: 2 retries with 1s delay
 *   - Can be customized or disabled per request
 *
 * Prerequisites:
 *   - Set GOOGLE_CLOUD_PROJECT in .env
 *   - Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file
 *   - Optional: Set GOOGLE_CLOUD_REGION (default: europe-west4)
 *
 * Usage:
 *   npx ts-node scripts/manual-test-google-cloud.ts
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
  console.log(`Prompt: "${request.prompt.substring(0, 80)}..."`);
  console.log(`Model: ${request.model || 'default'}`);
  if (request.referenceImages) {
    console.log(`Reference Images: ${request.referenceImages.length}`);
  }

  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const startTime = Date.now();
    const response = await service.generate(request);
    const duration = Date.now() - startTime;

    console.log(`\n✅ Success!`);
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
    console.error(`\n❌ Test '${testName}' Failed:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    return null;
  }
}

async function main() {
  loadEnv();

  // Check configuration
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const region = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_AI_REGION || 'europe-west4';

  if (!projectId || !serviceAccountPath) {
    console.error('❌ Error: Missing configuration.');
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
    console.error(`❌ Service account file not found: ${serviceAccountPath}`);
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
  console.log('\n📋 Configuration:');
  console.log(`   Project: ${projectId}`);
  console.log(`   Region: ${region}`);
  console.log(`   EU Region: ${provider.isEURegion() ? '✅ Yes' : '⚠️ No'}`);

  // Show available models
  console.log('\n🎨 Available Models:');
  for (const model of provider.listModels()) {
    console.log(`   - ${model.id} (${model.displayName})`);
    console.log(`     Character Consistency: ${model.capabilities.characterConsistency ? '✅' : '❌'}`);
    console.log(`     Regions: ${model.availableRegions?.join(', ') || 'all'}`);
  }

  // Show retry settings
  console.log('\n🔄 Retry Settings (default):');
  console.log(`   Max Retries: ${DEFAULT_RETRY_OPTIONS.maxRetries}`);
  console.log(`   Delay: ${DEFAULT_RETRY_OPTIONS.delayMs}ms`);
  console.log(`   Incremental Backoff: ${DEFAULT_RETRY_OPTIONS.incrementalBackoff ? 'Yes' : 'No'}`);
  console.log('   (Using incremental backoff for character consistency tests)');

  console.log('\n' + '='.repeat(60));
  console.log('Starting tests...');
  console.log('='.repeat(60));

  // =====================================================
  // Test 1: Imagen 3 - Basic Text-to-Image
  // =====================================================
  await runTest('Imagen 3 - Basic Text-to-Image', {
    prompt: 'A beautiful sunset over mountains, photorealistic, high quality',
    model: 'imagen-3',
    aspectRatio: '16:9',
  }, service);

  // =====================================================
  // Test 2: Gemini Flash Image - Text-to-Image
  // =====================================================
  const characterResult = await runTest('Gemini Flash - Create Character', {
    prompt: 'A cute cartoon bear wearing a red hat and blue scarf, standing in a magical forest with glowing mushrooms, children book illustration style, watercolor texture, soft pastel colors, whimsical, full body visible',
    model: 'gemini-flash-image',
    aspectRatio: '1:1',
  }, service);

  // =====================================================
  // Test 3: Gemini Flash Image - Character Consistency
  // =====================================================
  if (characterResult && characterResult.images[0]?.base64) {
    console.log('\n✅ Using generated bear for character consistency test...');

    // Use incremental backoff for consecutive requests to avoid rate limits
    // Default: 2 retries, but with 1s → 2s → 3s delays
    const retryWithBackoff = {
      maxRetries: 3,
      delayMs: 1000,
      incrementalBackoff: true, // 1s, 2s, 3s delays
    };

    await runTest('Gemini Flash - Character Consistency (Dancing)', {
      prompt: 'dancing happily in the rain, jumping in puddles, children book illustration style, watercolor texture, joyful expression',
      model: 'gemini-flash-image',
      referenceImages: [
        {
          base64: characterResult.images[0].base64,
          mimeType: 'image/png',
        },
      ],
      subjectDescription: 'cute cartoon bear with red hat and blue scarf',
      retry: retryWithBackoff,
    }, service);

    await runTest('Gemini Flash - Character Consistency (Sleeping)', {
      prompt: 'sleeping peacefully in a cozy bed, cuddling a pillow, moonlight through window, children book illustration style',
      model: 'gemini-flash-image',
      referenceImages: [
        {
          base64: characterResult.images[0].base64,
          mimeType: 'image/png',
        },
      ],
      subjectDescription: 'cute cartoon bear with red hat and blue scarf',
      retry: retryWithBackoff,
    }, service);
  } else {
    console.log('\n⚠️ Skipping character consistency tests (no reference image)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
  console.log('\nOutput images saved in ./output directory.');
  console.log('Compare images to verify character consistency!');
}

main().catch(console.error);
