import * as fs from 'fs';
import * as path from 'path';
import { TTIProvider, TTIRequest, DEFAULT_RETRY_OPTIONS } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for Multi-Character Consistency
 *
 * This script attempts to generate two distinct characters and then use both
 * as reference images for a combined scene (e.g., a duel).
 *
 * Usage:
 *   npx ts-node scripts/manual-test-multi-character.ts
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
  console.log(`Prompt: "${request.prompt.substring(0, 80)}..."`);
  console.log(`Model: ${request.model || 'default'}`);
  if (request.referenceImages) {
    console.log(`Reference Images: ${request.referenceImages.length}`);
    if (request.subjectDescription) {
        console.log(`Subject Description: "${request.subjectDescription}"`);
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
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const region = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_AI_REGION || 'europe-west4';

  if (!projectId || !serviceAccountPath) {
    console.error('❌ Error: Missing configuration (PROJECT or CREDENTIALS).');
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

  // Common style for consistency
  const style = "cinematic lighting, western movie style, highly detailed, photorealistic, 8k";

  // =====================================================
  // Step 1: Generate Cowboy 1 (The Good)
  // =====================================================
  const cowboy1Prompt = `A heroic cowboy with a white hat, red bandana, blue denim shirt, clean shaven, confident smile. ${style}`;
  
  const result1 = await runTest('Cowboy 1 Generation', {
    prompt: cowboy1Prompt,
    model: 'gemini-flash-image',
    aspectRatio: '1:1',
  }, service);

  if (!result1?.images[0]?.base64) {
    console.error("Failed to generate Cowboy 1. Aborting.");
    return;
  }
  const cowboy1Image = result1.images[0].base64;

  console.log('Waiting 10s to avoid rate limits...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // =====================================================
  // Step 2: Generate Cowboy 2 (The Bad)
  // =====================================================
  const cowboy2Prompt = `A villainous cowboy with a black hat, black leather duster coat, handlebar mustache, mean expression, scar on cheek. ${style}`;
  
  const result2 = await runTest('Cowboy 2 Generation', {
    prompt: cowboy2Prompt,
    model: 'gemini-flash-image',
    aspectRatio: '1:1',
  }, service);

  if (!result2?.images[0]?.base64) {
    console.error("Failed to generate Cowboy 2. Aborting.");
    return;
  }
  const cowboy2Image = result2.images[0].base64;

  console.log('Waiting 10s to avoid rate limits...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // =====================================================
  // Step 3: Combined Scene (The Duel)
  // =====================================================
  console.log('\n🤠 Generating the Duel Scene with BOTH references...');

  // Use incremental backoff
  const retryWithBackoff = {
    maxRetries: 5,
    delayMs: 5000,
    incrementalBackoff: true,
  };

  // Experiment: Try to reference both characters
  // The current implementation of GoogleCloudProvider forces the prompt structure:
  // "Using the 2 reference images as a reference for the character [subjectDescription], generate..."
  
  // So we must describe the "subject" as the pair of them.
  const subjectDescription = "two cowboys, one hero in white hat and one villain in black hat";

  const duelPrompt = `Wide shot of a dusty western street at high noon. The two cowboys are facing each other in a duel standoff. The hero in the white hat is on the left, the villain in the black hat is on the right. Tense atmosphere. ${style}`;

  await runTest('Duel Scene (Multi-Reference)', {
    prompt: duelPrompt,
    model: 'gemini-flash-image',
    referenceImages: [
      { base64: cowboy1Image, mimeType: 'image/png' },
      { base64: cowboy2Image, mimeType: 'image/png' }
    ],
    subjectDescription: subjectDescription,
    retry: retryWithBackoff,
    aspectRatio: '16:9'
  }, service);

}

main().catch(console.error);
