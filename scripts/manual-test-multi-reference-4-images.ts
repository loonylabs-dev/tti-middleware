import * as fs from 'fs';
import * as path from 'path';
import { TTIRequest } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

/**
 * Manual test script for Multi-Reference with 4 Images
 *
 * This script tests combining 4 different reference images:
 * - 2 Cowboys (from previous test)
 * - 1 House
 * - 1 Horse
 *
 * It compares two approaches:
 * - Variant A: Raw Mode (prompt only, no subjectDescription)
 * - Variant B: With subjectDescription + prompt
 *
 * Usage:
 *   npx ts-node scripts/manual-test-multi-reference-4-images.ts
 *
 * Options:
 *   --generate-base   Generate base images first (cowboys, house, horse)
 *   --test-only       Only run combination tests (requires existing images)
 */

const OUTPUT_DIR = path.join(__dirname, '../output');
const REFERENCE_IMAGES_DIR = path.join(OUTPUT_DIR, 'reference-images');

// File names for reference images
const IMAGE_FILES = {
  cowboy1: 'cowboy1_hero.png',
  cowboy2: 'cowboy2_villain.png',
  house: 'house_western.png',
  horse: 'horse_brown.png',
};

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
    }
  } catch (error) {
    console.error('Error loading .env:', error);
  }
}

function ensureDirectories() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(REFERENCE_IMAGES_DIR)) {
    fs.mkdirSync(REFERENCE_IMAGES_DIR, { recursive: true });
  }
}

function loadReferenceImage(filename: string): string | null {
  const filepath = path.join(REFERENCE_IMAGES_DIR, filename);
  if (fs.existsSync(filepath)) {
    return fs.readFileSync(filepath, 'base64');
  }
  return null;
}

function saveReferenceImage(filename: string, base64: string) {
  const filepath = path.join(REFERENCE_IMAGES_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
  console.log(`   Saved reference: ${filepath}`);
}

async function generateImage(
  service: TTIService,
  testName: string,
  request: TTIRequest
): Promise<string | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`GENERATING: ${testName}`);
  console.log('='.repeat(60));
  console.log(`Prompt: "${request.prompt.substring(0, 100)}..."`);

  try {
    const startTime = Date.now();
    const response = await service.generate(request);
    const duration = Date.now() - startTime;

    console.log(`✅ Success! Duration: ${duration}ms`);

    if (response.images[0]?.base64) {
      return response.images[0].base64;
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

async function generateBaseImages(service: TTIService) {
  console.log('\n📷 PHASE 1: Generating Base Reference Images');
  console.log('='.repeat(60));

  const style = 'cinematic lighting, western movie style, highly detailed, photorealistic, 8k';
  const waitTime = 10000;

  // Cowboy 1 (Hero)
  if (!loadReferenceImage(IMAGE_FILES.cowboy1)) {
    const cowboy1 = await generateImage(service, 'Cowboy 1 (Hero)', {
      prompt: `A heroic cowboy with a white hat, red bandana, blue denim shirt, clean shaven, confident smile. Full body shot, standing pose. ${style}`,
      model: 'gemini-flash-image',
      aspectRatio: '1:1',
    });
    if (cowboy1) {
      saveReferenceImage(IMAGE_FILES.cowboy1, cowboy1);
    }
    console.log(`Waiting ${waitTime / 1000}s to avoid rate limits...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  } else {
    console.log(`✓ ${IMAGE_FILES.cowboy1} already exists, skipping.`);
  }

  // Cowboy 2 (Villain)
  if (!loadReferenceImage(IMAGE_FILES.cowboy2)) {
    const cowboy2 = await generateImage(service, 'Cowboy 2 (Villain)', {
      prompt: `A villainous cowboy with a black hat, black leather duster coat, handlebar mustache, mean expression, scar on cheek. Full body shot, standing pose. ${style}`,
      model: 'gemini-flash-image',
      aspectRatio: '1:1',
    });
    if (cowboy2) {
      saveReferenceImage(IMAGE_FILES.cowboy2, cowboy2);
    }
    console.log(`Waiting ${waitTime / 1000}s to avoid rate limits...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  } else {
    console.log(`✓ ${IMAGE_FILES.cowboy2} already exists, skipping.`);
  }

  // House (Western Saloon)
  if (!loadReferenceImage(IMAGE_FILES.house)) {
    const house = await generateImage(service, 'Western House/Saloon', {
      prompt: `A classic western saloon building with wooden facade, swinging doors, "SALOON" sign, hitching post in front, dusty street. ${style}`,
      model: 'gemini-flash-image',
      aspectRatio: '1:1',
    });
    if (house) {
      saveReferenceImage(IMAGE_FILES.house, house);
    }
    console.log(`Waiting ${waitTime / 1000}s to avoid rate limits...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  } else {
    console.log(`✓ ${IMAGE_FILES.house} already exists, skipping.`);
  }

  // Horse
  if (!loadReferenceImage(IMAGE_FILES.horse)) {
    const horse = await generateImage(service, 'Brown Horse', {
      prompt: `A beautiful brown horse with black mane, western saddle, standing proudly. Side view. ${style}`,
      model: 'gemini-flash-image',
      aspectRatio: '1:1',
    });
    if (horse) {
      saveReferenceImage(IMAGE_FILES.horse, horse);
    }
  } else {
    console.log(`✓ ${IMAGE_FILES.horse} already exists, skipping.`);
  }
}

async function runCombinationTests(service: TTIService) {
  console.log('\n🎬 PHASE 2: Running Combination Tests');
  console.log('='.repeat(60));

  // Load all reference images
  const cowboy1 = loadReferenceImage(IMAGE_FILES.cowboy1);
  const cowboy2 = loadReferenceImage(IMAGE_FILES.cowboy2);
  const house = loadReferenceImage(IMAGE_FILES.house);
  const horse = loadReferenceImage(IMAGE_FILES.horse);

  if (!cowboy1 || !cowboy2 || !house || !horse) {
    console.error('❌ Missing reference images. Run with --generate-base first.');
    console.log('   Missing:', {
      cowboy1: !cowboy1,
      cowboy2: !cowboy2,
      house: !house,
      horse: !horse,
    });
    return;
  }

  console.log('✓ All 4 reference images loaded.');

  const style = 'cinematic lighting, western movie style, highly detailed, photorealistic, 8k';
  const retryConfig = {
    maxRetries: 5,
    delayMs: 5000,
    incrementalBackoff: true,
  };

  // =====================================================
  // Test A: Raw Mode (Multi-Subject) - User builds prompt
  // =====================================================
  console.log('\n--- TEST A: Raw Mode (no subjectDescription) ---');
  console.log('The prompt explicitly references each image by position.');

  const rawModePrompt = `
Generate a wide cinematic scene of a western town.

The following reference images are provided:
- FIRST reference image: A heroic cowboy in white hat (Cowboy A)
- SECOND reference image: A villainous cowboy in black hat (Cowboy B)
- THIRD reference image: A western saloon building
- FOURTH reference image: A brown horse

Scene composition:
- Cowboy A (from FIRST reference) stands on the left side of the street, hand near his holster
- Cowboy B (from SECOND reference) stands on the right side, facing Cowboy A menacingly
- The saloon (from THIRD reference) is visible in the background center
- The horse (from FOURTH reference) is tied to a hitching post near the saloon

Maintain exact visual consistency with each reference image. ${style}
`.trim();

  const resultA = await generateImage(service, 'Test A: Raw Mode (4 refs)', {
    prompt: rawModePrompt,
    model: 'gemini-flash-image',
    referenceImages: [
      { base64: cowboy1, mimeType: 'image/png' },
      { base64: cowboy2, mimeType: 'image/png' },
      { base64: house, mimeType: 'image/png' },
      { base64: horse, mimeType: 'image/png' },
    ],
    // NO subjectDescription - Raw Mode!
    retry: retryConfig,
    aspectRatio: '16:9',
  });

  if (resultA) {
    const filename = `test_a_raw_mode_${Date.now()}.png`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(resultA, 'base64'));
    console.log(`   Saved: ${path.join(OUTPUT_DIR, filename)}`);
  }

  console.log('Waiting 15s before next test...');
  await new Promise((resolve) => setTimeout(resolve, 15000));

  // =====================================================
  // Test B: With subjectDescription (Template Mode)
  // =====================================================
  console.log('\n--- TEST B: Template Mode (with subjectDescription) ---');
  console.log('Using subjectDescription to describe all subjects together.');

  const subjectDescription =
    'Cowboy A (hero in white); Cowboy B (villain in black); Western saloon; Brown horse';

  const templateModePrompt = `Wide cinematic shot of a western duel scene. Cowboy A and Cowboy B face each other in the street. The saloon is in the background. The horse is tied to a post. Tense atmosphere at high noon. ${style}`;

  const resultB = await generateImage(service, 'Test B: Template Mode (4 refs)', {
    prompt: templateModePrompt,
    model: 'gemini-flash-image',
    referenceImages: [
      { base64: cowboy1, mimeType: 'image/png' },
      { base64: cowboy2, mimeType: 'image/png' },
      { base64: house, mimeType: 'image/png' },
      { base64: horse, mimeType: 'image/png' },
    ],
    subjectDescription: subjectDescription,
    retry: retryConfig,
    aspectRatio: '16:9',
  });

  if (resultB) {
    const filename = `test_b_template_mode_${Date.now()}.png`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(resultB, 'base64'));
    console.log(`   Saved: ${path.join(OUTPUT_DIR, filename)}`);
  }

  // =====================================================
  // Summary
  // =====================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('Test A (Raw Mode):     ', resultA ? '✅ Success' : '❌ Failed');
  console.log('Test B (Template Mode):', resultB ? '✅ Success' : '❌ Failed');
  console.log('\nCheck the output folder to compare image quality.');
  console.log(`Output: ${OUTPUT_DIR}`);
}

async function main() {
  loadEnv();
  ensureDirectories();

  const args = process.argv.slice(2);
  const generateBase = args.includes('--generate-base');
  const testOnly = args.includes('--test-only');

  // Check configuration
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const region = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_AI_REGION || 'europe-west4';

  if (!projectId || !serviceAccountPath) {
    console.error('❌ Error: Missing configuration (PROJECT or CREDENTIALS).');
    process.exit(1);
  }

  // Initialize service
  const service = new TTIService();
  const provider = new GoogleCloudTTIProvider({
    projectId,
    region: region as 'europe-west4',
  });
  service.registerProvider(provider);

  console.log('\n📋 Configuration:');
  console.log(`   Project: ${projectId}`);
  console.log(`   Region: ${region}`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log(`   References: ${REFERENCE_IMAGES_DIR}`);

  if (testOnly) {
    // Only run combination tests
    await runCombinationTests(service);
  } else if (generateBase) {
    // Only generate base images
    await generateBaseImages(service);
  } else {
    // Default: Generate base images if missing, then run tests
    await generateBaseImages(service);
    console.log('\nWaiting 15s before combination tests...');
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await runCombinationTests(service);
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
