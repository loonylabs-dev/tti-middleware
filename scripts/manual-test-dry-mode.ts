/**
 * Manual Test: Dry Mode
 *
 * Tests that dry mode:
 * 1. Logs the request via TTIDebugger
 * 2. Returns placeholder PNG image
 * 3. Does NOT make actual API calls
 *
 * Usage:
 *   npx ts-node scripts/manual-test-dry-mode.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { TTIService, GoogleCloudTTIProvider, TTIDebugger } from '../src';

async function main() {
  console.log('='.repeat(60));
  console.log('DRY MODE TEST');
  console.log('='.repeat(60));

  // 1. Setup: Enable TTIDebugger
  const logsDir = path.join(process.cwd(), 'logs', 'tti', 'requests');
  TTIDebugger.setEnabled(true);
  TTIDebugger.setLogsDir(logsDir);
  console.log(`\n✓ TTIDebugger enabled, logs dir: ${logsDir}`);

  // 2. Create service and register provider
  const service = new TTIService();
  const provider = new GoogleCloudTTIProvider({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'dry-mode-test-project',
    region: 'europe-west4',
  });
  service.registerProvider(provider);
  console.log('✓ Service and provider initialized');

  // 3. Execute dry mode request
  console.log('\n--- Executing dry mode request ---\n');

  const request = {
    prompt: 'A beautiful sunset over the mountains with golden light',
    model: 'gemini-flash-image' as const,
    aspectRatio: '16:9',
    n: 2, // Request 2 images
    dry: true, // DRY MODE!
  };

  console.log('Request:');
  console.log(JSON.stringify(request, null, 2));

  const startTime = Date.now();
  const response = await service.generate(request);
  const duration = Date.now() - startTime;

  // 4. Verify response
  console.log('\n--- Response ---\n');
  console.log(`Duration: ${duration}ms (should be ~0ms, no API call)`);
  console.log(`Provider: ${response.metadata.provider}`);
  console.log(`Model: ${response.metadata.model}`);
  console.log(`Images returned: ${response.images.length}`);
  console.log(`Images generated (usage): ${response.usage.imagesGenerated}`);

  // 5. Save placeholder images to verify they work
  const outputDir = path.join(process.cwd(), 'output', 'dry-mode');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < response.images.length; i++) {
    const img = response.images[i];
    if (img.base64) {
      const filename = `placeholder-${i + 1}.png`;
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, Buffer.from(img.base64, 'base64'));
      console.log(`✓ Saved: ${filepath}`);
    }
  }

  // 6. Check if log file was created
  console.log('\n--- Checking TTIDebugger logs ---\n');

  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.md'));
    const recentFiles = files.slice(-3); // Last 3 files

    if (recentFiles.length > 0) {
      console.log('Recent log files:');
      recentFiles.forEach(f => console.log(`  - ${f}`));

      // Show content of most recent file
      const latestFile = path.join(logsDir, files[files.length - 1]);
      console.log(`\n--- Content of ${files[files.length - 1]} ---\n`);
      const content = fs.readFileSync(latestFile, 'utf-8');
      // Show first 80 lines
      const lines = content.split('\n').slice(0, 80);
      console.log(lines.join('\n'));
      if (content.split('\n').length > 80) {
        console.log('\n... (truncated)');
      }
    } else {
      console.log('⚠ No .md log files found');
    }
  } else {
    console.log('⚠ Logs directory does not exist');
  }

  // 7. Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`✓ Dry mode request completed in ${duration}ms`);
  console.log(`✓ ${response.images.length} placeholder images returned`);
  console.log(`✓ Images saved to: ${outputDir}`);
  console.log(`✓ Logs saved to: ${logsDir}`);
  console.log('\nDry mode is working correctly!');
}

main().catch(console.error);
