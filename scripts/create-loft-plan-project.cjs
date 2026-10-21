// Creates a private, importable home project from the supplied 1280×875 floor-plan image.
// Usage: node scripts/create-loft-plan-project.cjs <image.jpg> [output.json]
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Pass the JPEG floor-plan path.');
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(process.argv[3] || path.join(root, 'local-projects', '复式一室一厅-已标注.json'));
  const image = readFileSync(input);
  if (image[0] !== 0xff || image[1] !== 0xd8) throw new Error('Expected a JPEG image.');
  const { createHomeProject } = await import(pathToFileURL(path.join(root, 'src/domain/home-packages.js')).href);
  const project = createHomeProject('starter', 'loft1b1b');
  const zone = (id, kind, x, y, w, h, dimensionsLabel, width, depth) => ({ id, kind, x, y, w, h,
    ...(dimensionsLabel ? { dimensionsLabel, dimensionsMm: { width, depth } } : {}) });
  project.site = {
    source: { kind: 'image', fileName: path.basename(input), dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`,
      widthPx: 1280, heightPx: 875 },
    note: '用户提供的主层＋夹层户型图。彩色框为示意位置，不是墙体测量；图示尺寸只见客厅、主卧、夹层。挑空、楼梯、储物与室外露台不可按普通房间配置家具。厨房、餐厅、卫生间及净门宽待实测。',
    zones: [
      zone('main-living', 'living', 150, 190, 232, 252, '12′0″ × 12′10″', 3658, 3912),
      zone('main-bedroom', 'bedroom', 395, 185, 208, 258, '11′0″ × 14′0″', 3353, 4267),
      zone('main-kitchen', 'kitchen', 150, 453, 237, 158),
      zone('main-dining', 'dining', 150, 632, 231, 118),
      zone('main-bathroom', 'bathroom', 466, 633, 135, 119),
      zone('main-stairs', 'stairs', 253, 759, 198, 61),
      zone('main-deck', 'deck', 365, 62, 217, 105),
      zone('upper-void', 'void', 709, 321, 229, 427),
      zone('upper-mezzanine', 'mezzanine', 952, 322, 214, 210, '10′10″ × 11′0″', 3302, 3353),
      zone('upper-closet', 'closet', 1020, 544, 144, 40),
      zone('upper-stairs', 'stairs', 815, 753, 201, 67),
    ],
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(project, null, 2));
  process.stdout.write(`${output}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
