import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'logo.svg');
const svg = fs.readFileSync(svgPath);

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'favicon.png', size: 64 },
];

for (const { file, size } of targets) {
  const out = path.join(publicDir, file);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`generated ${file} (${size}x${size})`);
}
