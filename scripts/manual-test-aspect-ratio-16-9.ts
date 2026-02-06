import * as fs from 'fs';
import * as path from 'path';
import { TTIRequest } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for 16:9 aspect ratio with Gemini Flash Image
 *
 * This script tests the fix for the aspect ratio bug where gemini-flash-image
 * was ignoring the aspectRatio parameter and always generating 1:1 images.
 *
 * Prerequisites:
 *   - Set GOOGLE_CLOUD_PROJECT in .env
 *   - Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file
 *   - Optional: Set GOOGLE_CLOUD_REGION (default: europe-west4)
 *
 * Usage:
 *   npx ts-node scripts/manual-test-aspect-ratio-16-9.ts
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

  console.log('\n📋 Configuration:');
  console.log(`   Project: ${projectId}`);
  console.log(`   Region: ${region}`);

  console.log('\n🧪 Testing 16:9 Aspect Ratio with Gemini Flash Image...\n');

  // Test request with 16:9 aspect ratio
  const request: TTIRequest = {
    prompt: 'A young, fluffy rabbit with long ears stands on vibrant green moss, holding a colorful flower. Warm sunbeams illuminate the peaceful scene. Cartoon illustration style with simple geometric shapes and soft, gentle colors.',
    model: 'gemini-flash-image',
    aspectRatio: '16:9',
    retry: true,
  };

  console.log(`Prompt: "${request.prompt.substring(0, 80)}..."`);
  console.log(`Model: ${request.model}`);
  console.log(`Aspect Ratio: ${request.aspectRatio}`);

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
    console.log(`   Images Generated: ${response.usage.imagesGenerated}`);

    response.images.forEach((img, index) => {
      if (img.base64) {
        const fileName = `gemini-flash-16-9_${Date.now()}_${index}.png`;
        const outputPath = path.join(outputDir, fileName);
        const buffer = Buffer.from(img.base64, 'base64');
        fs.writeFileSync(outputPath, buffer);
        console.log(`   Saved: ${outputPath}`);

        // Try to read image dimensions using PNG header
        // PNG width/height are at bytes 16-23 (big-endian)
        if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
          const width = buffer.readUInt32BE(16);
          const height = buffer.readUInt32BE(20);
          const actualRatio = (width / height).toFixed(2);
          const expectedRatio = (16 / 9).toFixed(2); // 1.78

          console.log(`   Dimensions: ${width}x${height} (ratio: ${actualRatio})`);
          console.log(`   Expected Ratio: ${expectedRatio} (16:9)`);

          if (Math.abs(parseFloat(actualRatio) - parseFloat(expectedRatio)) < 0.1) {
            console.log(`   ✅ Aspect ratio is correct!`);
          } else {
            console.log(`   ❌ Aspect ratio mismatch! Got ${actualRatio}, expected ${expectedRatio}`);
          }
        }
      }
    });

    console.log('\n✅ Test completed successfully!');
    console.log('Check the output directory to verify the image is 16:9.');
  } catch (error) {
    console.error(`\n❌ Test Failed:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);
