import * as fs from 'fs';
import * as path from 'path';
import { TTIRequest, TTIResponse } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for Multi-Character Consistency using Index-based referencing
 *
 * This test uses existing generated images and attempts to reference them by index
 * (e.g., "Image 1", "Image 2") in the prompt, bypassing the strict "single subject"
 * template of the middleware.
 *
 * Usage:
 *   npx ts-node scripts/manual-test-multi-character-indices.ts
 */

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
  console.log(`Prompt: "${request.prompt}"`);
  console.log(`Model: ${request.model || 'default'}`);
  if (request.referenceImages) {
    console.log(`Reference Images: ${request.referenceImages.length}`);
    if (request.subjectDescription) {
        console.log(`Subject Description: "${request.subjectDescription}"`);
    } else {
        console.log(`Subject Description: (None - Raw Multimodal Mode)`);
    }
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
    
    response.images.forEach((img, index) => {
      if (img.base64) {
        // Create a safe filename from the test name
        const safeTestName = testName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeTestName}_${Date.now()}_${index}.png`;
        const outputPath = path.join(outputDir, fileName);
        fs.writeFileSync(outputPath, Buffer.from(img.base64, 'base64'));
        console.log(`   Saved: ${outputPath}`);
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
  const region = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_AI_REGION || 'europe-west4';

  if (!projectId) {
    console.error('❌ Error: Missing configuration (PROJECT).');
    process.exit(1);
  }

  // Initialize
  const service = new TTIService();
  const provider = new GoogleCloudTTIProvider({
    projectId,
    region: region as any,
  });
  service.registerProvider(provider);

  console.log('\n📋 Configuration:');
  console.log(`   Project: ${projectId}`);
  console.log(`   Region: ${region}`);

  // Load existing images
  // Using the specific files requested by the user
  const img1Path = path.join(__dirname, '../output/cowboy_1_generation_1769368239348_0.png');
  const img2Path = path.join(__dirname, '../output/cowboy_2_generation_1769368245871_0.png');

  if (!fs.existsSync(img1Path)) {
      console.error(`❌ Image 1 not found at: ${img1Path}`);
      return;
  }
  if (!fs.existsSync(img2Path)) {
      console.error(`❌ Image 2 not found at: ${img2Path}`);
      return;
  }

  console.log('Loading reference images...');
  const img1 = fs.readFileSync(img1Path).toString('base64');
  const img2 = fs.readFileSync(img2Path).toString('base64');

  // =====================================================
  // Test: Index-based Referencing (No Subject Description)
  // =====================================================
  
  // Explicitly mapping indices to characters in the prompt
  // The Gemini model receives [Image 1, Image 2, Text]
  // We assume the order in the array corresponds to the "index" the model perceives, 
  // or we just refer to them conceptually.
  const prompt = `
Generate a cinematic wide shot of a western duel.

The scene features two characters facing each other.
- The character on the LEFT should look exactly like the person in the FIRST reference image.
- The character on the RIGHT should look exactly like the person in the SECOND reference image.

They are standing in a dusty street at high noon. The atmosphere is tense.
Maintain the exact clothing, facial features, and style of the reference images for each respective character.
  `.trim();

  console.log('\n🤠 Generating Duel Scene using Index-based Referencing...');

  await runTest('Duel Scene (Index Based)', {
    prompt: prompt,
    model: 'gemini-flash-image',
    referenceImages: [
      { base64: img1, mimeType: 'image/png' },
      { base64: img2, mimeType: 'image/png' }
    ],
    // IMPORTANT: subjectDescription is intentionally OMITTED
    // This triggers the "raw" mode in the modified GoogleCloudProvider,
    // allowing us to control the referencing logic in the prompt itself.
    aspectRatio: '16:9'
  }, service);

}

main().catch(console.error);
