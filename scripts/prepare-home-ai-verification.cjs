// Make a private copy of the supplied loft project for a positive/negative AI reading check.
// The original JSON and image remain unchanged; the output must not already exist.
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.argv[2] || path.join(root, 'local-projects', '复式一室一厅-已标注.json'));
const output = path.resolve(process.argv[3] || path.join(root, 'local-projects', '复式一室一厅-AI读取验证.json'));
if (source === output) throw new Error('Output must differ from source.');

const project = JSON.parse(readFileSync(source, 'utf8'));
const living = project.site?.zones?.find(zone => zone.id === 'main-living' && zone.kind === 'living');
const dining = project.site?.zones?.find(zone => zone.id === 'main-dining' && zone.kind === 'dining');
if (project.projectType !== 'home' || project.site?.source?.kind !== 'image' ||
    !living?.dimensionsMm || !dining || dining.dimensionsMm) {
  throw new Error('Expected the labeled loft project with a dimensioned living room and unlabeled dining room.');
}
delete living.dimensionsMm;
delete living.dimensionsLabel;
delete living.dimensionSource;
delete living.dimensionEvidence;
project.site.note = `${project.site.note || ''} AI 读取验证副本：客厅图示尺寸暂不录入；原项目未修改。`.slice(0, 500);

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(project, null, 2), { flag: 'wx' });
process.stdout.write(`${output}\n`);
