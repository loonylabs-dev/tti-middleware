/**
 * Manual live test for the BFL (FLUX) provider against the real EU API.
 *
 * Runs REAL API calls and SPENDS CREDITS. Each step is selectable so credit
 * spend stays controlled. Generated images are written to output/bfl-live/.
 *
 * Usage:
 *   npx ts-node tests/manual/bfl-live-test.ts <step> [step...]
 *
 * Steps (cheapest first):
 *   t2i-flux11       FLUX1.1 [pro] text-to-image            (~4 credits)
 *   t2i-flux2        FLUX.2 [pro] text-to-image, small      (~1 credit @ 512px)
 *   aspect           FLUX1.1 [pro] 16:9 aspect ratio        (~4 credits)
 *   kontext          FLUX.1 Kontext [pro] edit w/ reference (~4 credits)
 *   flux2-multiref   FLUX.2 [pro] multi-reference editing   (~5 credits)
 *   urls             returnUrls=true (no download), flux2    (~1 credit)
 *   all              run every step (~19 credits)
 *
 * The reference-image steps reuse images produced by earlier steps, so run
 * `t2i-flux11` (and `t2i-flux2`) before `kontext` / `flux2-multiref`, or just
 * use `all`.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { BflProvider } from '../../src/middleware/services/tti/providers/bfl-provider';
import { TTIRequest, TTIResponse } from '../../src/middleware/types';

const OUT_DIR = path.resolve(__dirname, '../../output/bfl-live');

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

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

async function run(label: string, req: TTIRequest, provider: BflProvider, saveName: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`    model=${req.model} prompt="${req.prompt.slice(0, 60)}..."`);
  const t = Date.now();
  try {
    const res = await provider.generate(req);
    const dur = Date.now() - t;
    const img = res.images[0];
    console.log(`    ✅ OK in ${dur}ms — images=${res.images.length}, ` +
      `${img.base64 ? `base64=${img.base64.length} chars, type=${img.contentType}` : `url=${img.url}`}`);
    const paths = save(saveName, res);
    paths.forEach((p) => console.log(`    💾 ${p}`));
    return true;
  } catch (err) {
    const dur = Date.now() - t;
    const e = err as Error;
    console.log(`    ❌ FAILED in ${dur}ms — ${e.name}: ${e.message}`);
    return false;
  }
}

async function main() {
  ensureOutDir();
  const args = process.argv.slice(2);
  const steps = args.includes('all')
    ? ['t2i-flux11', 't2i-flux2', 'aspect', 'kontext', 'flux2-multiref', 'urls']
    : args;

  if (steps.length === 0) {
    console.log('No steps given. See file header for available steps.');
    process.exit(1);
  }

  const provider = new BflProvider();
  console.log(`BFL live test — steps: ${steps.join(', ')}`);
  console.log(`Output dir: ${OUT_DIR}`);

  const results: Record<string, boolean> = {};

  for (const step of steps) {
    switch (step) {
      case 't2i-flux11':
        results[step] = await run(
          'FLUX1.1 [pro] — text-to-image',
          {
            model: 'flux-1.1-pro',
            prompt: 'A cute robot mascot waving, flat vector illustration, white background',
            aspectRatio: '1:1',
            retry: false,
          },
          provider,
          'flux11-t2i'
        );
        break;

      case 't2i-flux2':
        results[step] = await run(
          'FLUX.2 [pro] — text-to-image (small, cost-saving)',
          {
            model: 'flux-2-pro',
            prompt: 'A friendly orange cat sitting, flat vector illustration, white background',
            retry: false,
            providerOptions: { width: 512, height: 512, outputFormat: 'png' },
          },
          provider,
          'flux2-t2i'
        );
        break;

      case 'aspect':
        results[step] = await run(
          'FLUX1.1 [pro] — 16:9 aspect ratio',
          {
            model: 'flux-1.1-pro',
            prompt: 'A wide mountain landscape at sunset, cinematic',
            aspectRatio: '16:9',
            retry: false,
          },
          provider,
          'flux11-16x9'
        );
        break;

      case 'kontext': {
        const ref = loadBase64('flux11-t2i');
        if (!ref) {
          console.log('\n=== FLUX.1 Kontext — SKIPPED (run t2i-flux11 first to create a reference) ===');
          results[step] = false;
          break;
        }
        results[step] = await run(
          'FLUX.1 Kontext [pro] — edit with reference image',
          {
            model: 'flux-kontext-pro',
            prompt: 'Change the background to a sunny park with trees, keep the character identical',
            referenceImages: [{ base64: ref }],
            aspectRatio: '1:1',
            retry: false,
          },
          provider,
          'kontext-edit'
        );
        break;
      }

      case 'flux2-multiref': {
        const ref1 = loadBase64('flux11-t2i');
        const ref2 = loadBase64('flux2-t2i');
        if (!ref1 || !ref2) {
          console.log('\n=== FLUX.2 multi-ref — SKIPPED (run t2i-flux11 and t2i-flux2 first) ===');
          results[step] = false;
          break;
        }
        results[step] = await run(
          'FLUX.2 [pro] — multi-reference editing',
          {
            model: 'flux-2-pro',
            prompt: 'Put the robot and the cat together in one scene, sitting side by side',
            referenceImages: [{ base64: ref1 }, { base64: ref2 }],
            retry: false,
            providerOptions: { width: 512, height: 512 },
          },
          provider,
          'flux2-multiref'
        );
        break;
      }

      case 'urls':
        results[step] = await run(
          'FLUX.2 [pro] — returnUrls (no download)',
          {
            model: 'flux-2-pro',
            prompt: 'A single red apple on a table',
            retry: false,
            providerOptions: { width: 512, height: 512, returnUrls: true },
          },
          provider,
          'flux2-url'
        );
        break;

      default:
        console.log(`Unknown step: ${step}`);
        results[step] = false;
    }
  }

  console.log('\n========== SUMMARY ==========');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${v ? '✅' : '❌'} ${k}`);
  }
  const ok = Object.values(results).filter(Boolean).length;
  console.log(`  ${ok}/${Object.keys(results).length} passed`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
