import * as fs from 'fs';
import * as path from 'path';
import { TTIProvider, TTIGenerateRequest } from '../src/middleware/types';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { EdenAIProvider } from '../src/middleware/services/tti/providers/edenai-provider';

/**
 * Manual test script for EdenAI TTI provider
 * 
 * Usage:
 *   npx ts-node scripts/manual-test-edenai.ts
 */

// Simple .env parser since dotenv might not be installed
function loadEnv() {
  try {
    // Look for .env in project root
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf8');
      envConfig.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^['"](.*)['"]$/, '$1'); // Remove quotes
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
      console.log('.env file loaded from root.');
    } else {
      console.warn('No .env file found in root. Relying on system environment variables.');
    }
  } catch (error) {
    console.error('Error loading .env file:', error);
  }
}

async function runGenerationTest(
  testName: string, 
  params: TTIGenerateRequest, 
  service: TTIService
) {
  console.log(`\n--- Running Test: ${testName} ---`);
  console.log(`Prompt: "${params.prompt}"`);
  console.log(`Provider: ${params.providerOptions?.provider || 'default (openai)'}`);

  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const startTime = Date.now();
    // Force usage of EdenAI provider for this test script
    const response = await service.generateImage(params, TTIProvider.EDENAI);
    const duration = Date.now() - startTime;

    console.log(`✅ Success!`);
    console.log(`   - Latency: ${duration}ms`);
    console.log(`   - Provider: ${response.metadata.provider}`);
    
    response.images.forEach((img, index) => {
        if (img.base64) {
            const fileName = `edenai_${Date.now()}_${index}.png`;
            const outputPath = path.join(outputDir, fileName);
            fs.writeFileSync(outputPath, Buffer.from(img.base64, 'base64'));
            console.log(`   - Saved Image: ${outputPath}`);
        } else if (img.url) {
            console.log(`   - Image URL: ${img.url}`);
        }
    });

  } catch (error) {
    console.error(`❌ Test '${testName}' Failed:`, error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
    }
  }
}

async function main() {
  // 1. Load environment variables
  loadEnv();

  if (!process.env.EDENAI_API_KEY) {
    console.error('❌ Error: EDENAI_API_KEY is not set.');
    console.error('Please create a .env file in the tti-middleware directory with your key.');
    process.exit(1);
  }

  // Initialize Service
  const ttiService = new TTIService();
  ttiService.registerProvider(new EdenAIProvider({
      apiKey: process.env.EDENAI_API_KEY
  }));

  console.log('Starting manual Eden AI tests...');

  // 2. Run Test
  await runGenerationTest(
    'Simple Cyberpunk City (OpenAI via EdenAI)',
    {
      prompt: 'A futuristic city with flying cars, cyberpunk style, neon lights, rainy night',
      size: '1024x1024',
      n: 1,
      providerOptions: { provider: 'openai' }
    },
    ttiService
  );
}

main();
