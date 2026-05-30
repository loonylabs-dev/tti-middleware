/**
 * Manual live test for the Azure Foundry (FLUX) provider against a real
 * Microsoft Foundry deployment.
 *
 * Runs REAL API calls and SPENDS Azure quota. Each step is selectable so spend
 * stays controlled. Generated images are written to output/azure-foundry-live/.
 *
 * Usage:
 *   npx ts-node tests/manual/azure-foundry-live-test.ts <step> [step...]
 *
 * Steps:
 *   t2i        FLUX.2 [pro] text-to-image (1:1)
 *   aspect     FLUX.2 [pro] 16:9 aspect ratio
 *   multiref   FLUX.2 [pro] multi-reference editing (needs `t2i` first)
 *   all        t2i + aspect + multiref
 *
 * Env (reads AZURE_FOUNDRY_* first, falls back to AZURE_OPENAI_* — same
 * Foundry resource exposes both the OpenAI and the blackforestlabs routes):
 *   AZURE_FOUNDRY_ENDPOINT / AZURE_OPENAI_ENDPOINT
 *   AZURE_FOUNDRY_API_KEY  / AZURE_OPENAI_API_KEY
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { AzureFoundryProvider } from '../../src/middleware/services/tti/providers/azure-foundry-provider';
import { TTIRequest, TTIResponse } from '../../src/middleware/types';

const OUT_DIR = path.resolve(__dirname, '../../output/azure-foundry-live');

const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '';
const apiKey = process.env.AZURE_FOUNDRY_API_KEY || process.env.AZURE_OPENAI_API_KEY || '';

function save(name: string, res: TTIResponse): string[] {
  const paths: string[] = [];
  res.images.forEach((img, i) => {
    if (img.base64) {
      const ext = (img.contentType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
      const p = path.join(OUT_DIR, `${name}-${i}.${ext}`);
      fs.writeFileSync(p, Buffer.from(img.base64, 'base64'));
      paths.push(p);
    } else if (img.url) {
      paths.push(`URL: ${img.url}`);
    }
  });
  return paths;
}

function loadBase64(name: string): string | null {
  for (const ext of ['jpg', 'png']) {
    const p = path.join(OUT_DIR, `${name}-0.${ext}`);
    if (fs.existsSync(p)) return fs.readFileSync(p).toString('base64');
  }
  return null;
}

async function run(label: string, req: TTIRequest, provider: AzureFoundryProvider, saveName: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`    model=${req.model} prompt="${req.prompt.slice(0, 60)}..."`);
  const t = Date.now();
  try {
    const res = await provider.generate(req);
    const dur = Date.now() - t;
    const img = res.images[0];
    console.log(
      `    ✅ OK in ${dur}ms — images=${res.images.length}, ` +
        `${img.base64 ? `base64=${img.base64.length} chars, type=${img.contentType}` : `url=${img.url}`}`
    );
    save(saveName, res).forEach((p) => console.log(`    💾 ${p}`));
    return true;
  } catch (err) {
    const e = err as Error;
    console.log(`    ❌ FAILED in ${Date.now() - t}ms — ${e.name}: ${e.message}`);
    return false;
  }
}

async function main() {
  if (!endpoint || !apiKey) {
    console.error('❌ AZURE_(FOUNDRY|OPENAI)_ENDPOINT/API_KEY fehlen in .env');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const steps = args.includes('all') ? ['t2i', 'aspect', 'multiref'] : args;
  if (steps.length === 0) {
    console.log('No steps given. See file header for available steps.');
    process.exit(1);
  }

  const provider = new AzureFoundryProvider({ endpoint, apiKey });
  console.log(`Azure Foundry live test — steps: ${steps.join(', ')}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Output dir: ${OUT_DIR}`);

  const results: Record<string, boolean> = {};

  for (const step of steps) {
    switch (step) {
      case 't2i':
        results[step] = await run(
          'FLUX.2 [pro] (Azure) — text-to-image',
          {
            model: 'flux-2-pro-azure',
            prompt: 'A cute robot mascot waving, flat vector illustration, white background',
            aspectRatio: '1:1',
            retry: false,
          },
          provider,
          'flux2-t2i'
        );
        break;

      case 'aspect':
        results[step] = await run(
          'FLUX.2 [pro] (Azure) — 16:9 aspect ratio',
          {
            model: 'flux-2-pro-azure',
            prompt: 'A wide mountain landscape at sunset, cinematic',
            aspectRatio: '16:9',
            retry: false,
          },
          provider,
          'flux2-16x9'
        );
        break;

      case 'multiref': {
        const ref = loadBase64('flux2-t2i');
        if (!ref) {
          console.log('\n=== multiref — SKIPPED (run `t2i` first to create a reference) ===');
          results[step] = false;
          break;
        }
        results[step] = await run(
          'FLUX.2 [pro] (Azure) — reference editing',
          {
            model: 'flux-2-pro-azure',
            prompt: 'Change the background to a sunny park with trees, keep the character identical',
            referenceImages: [{ base64: ref }],
            aspectRatio: '1:1',
            retry: false,
          },
          provider,
          'flux2-multiref'
        );
        break;
      }

      default:
        console.log(`Unknown step: ${step}`);
        results[step] = false;
    }
  }

  console.log('\n========== SUMMARY ==========');
  for (const [k, v] of Object.entries(results)) console.log(`  ${v ? '✅' : '❌'} ${k}`);
  const ok = Object.values(results).filter(Boolean).length;
  console.log(`  ${ok}/${Object.keys(results).length} passed`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
