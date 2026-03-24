/**
 * Quick test: duck in top-right corner via inpainting
 * npx ts-node scripts/manual-test-inpainting-duck.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { TTIService } from '../src/middleware/services/tti/tti.service';
import { GoogleCloudTTIProvider } from '../src/middleware/services/tti/providers/google-cloud-provider';

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()])
      process.env[m[1].trim()] = m[2].trim().replace(/^['"](.*)['"]$/, '$1');
  });
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii'), body = Buffer.concat([tb, data]);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([l, body, cb]);
}

function makePNG(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(2, 9);
  const raw = Buffer.alloc((1 + w * 3) * h);
  let i = 0;
  for (let y = 0; y < h; y++) {
    raw[i++] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); raw[i++] = r; raw[i++] = g; raw[i++] = b; }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  loadEnv();

  const W = 512, H = 512, ts = Date.now();
  const out = path.join(__dirname, '../output');
  if (!fs.existsSync(out)) fs.mkdirSync(out);

  // Base: hellgrauer Hintergrund
  const base = makePNG(W, H, () => [220, 220, 220]);

  // Mask: oben rechts — x: 55%–100%, y: 0%–45% → weiss (Edit-Zone), Rest schwarz
  const mask = makePNG(W, H, (x, y) =>
    (x >= W * 0.55 && y < H * 0.45) ? [255, 255, 255] : [0, 0, 0]
  );

  const basePath = path.join(out, `duck_base_${ts}.png`);
  const maskPath = path.join(out, `duck_mask_${ts}.png`);
  fs.writeFileSync(basePath, base);
  fs.writeFileSync(maskPath, mask);
  console.log(`Base saved: ${basePath}`);
  console.log(`Mask saved: ${maskPath}`);

  const provider = new GoogleCloudTTIProvider();
  const service = new TTIService();
  service.registerProvider(provider);

  console.log('\nCalling inpainting API...');
  const start = Date.now();

  const response = await service.generate({
    model: 'imagen-capability',
    prompt: 'A cute cartoon duck with yellow feathers and an orange beak, sitting, colorful illustration style',
    baseImage: { base64: base.toString('base64'), mimeType: 'image/png' },
    maskImage: { base64: mask.toString('base64'), mimeType: 'image/png' },
    editMode: 'inpainting-insert',
    maskDilation: 0.02,
    retry: { maxRetries: 2, delayMs: 3000, timeoutMs: 120000 },
  });

  console.log(`\n✅ Done in ${Date.now() - start}ms`);

  response.images.forEach((img, i) => {
    const p = path.join(out, `duck_result_${ts}_${i}.png`);
    fs.writeFileSync(p, Buffer.from(img.base64!, 'base64'));
    console.log(`Result saved: ${p}`);
  });
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
