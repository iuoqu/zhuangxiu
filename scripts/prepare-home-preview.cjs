const assert = require('node:assert/strict');
const { copyFileSync, existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'local-projects', 'ai-vercel-stage');
const expectedProject = {
  projectId: 'prj_cmlvPMIbvku9p2qZvlaT5kVMgIeW',
  orgId: 'team_N6SkpQIfjyLBsl9L4wsAfXUS',
};
const expectedFiles = new Set([
  '.gitignore',
  '.vercel/README.txt',
  '.vercel/project.json',
  'api/extract-plan-dimensions.js',
  'api/suggest-home-zones.js',
  'api/generate.js',
  'home.bundle.js',
  'home.html',
  'package.json',
  'vercel.json',
]);
const refreshedFiles = [
  'home.html',
  'home.bundle.js',
  'api/extract-plan-dimensions.js',
  'api/suggest-home-zones.js',
];

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), relative);
    assert.ok(entry.isFile(), `Unexpected deployment entry: ${relative}`);
    return [relative];
  });
}

assert.ok(existsSync(stage), 'The isolated Vercel stage is missing.');
const link = JSON.parse(readFileSync(path.join(stage, '.vercel', 'project.json'), 'utf8'));
assert.equal(link.projectId, expectedProject.projectId, 'Stage is linked to the wrong Vercel project.');
assert.equal(link.orgId, expectedProject.orgId, 'Stage is linked to the wrong Vercel team.');
for (const file of listFiles(stage)) {
  assert.ok(expectedFiles.has(file), `Refusing to deploy unexpected file: ${file}`);
}
for (const file of expectedFiles) {
  if (!refreshedFiles.includes(file)) assert.ok(existsSync(path.join(stage, ...file.split('/'))), `Missing stage file: ${file}`);
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-home.cjs')], { cwd: root, stdio: 'inherit' });
for (const file of refreshedFiles) {
  copyFileSync(path.join(root, ...file.split('/')), path.join(stage, ...file.split('/')));
}
for (const file of expectedFiles) {
  assert.ok(existsSync(path.join(stage, ...file.split('/'))), `Missing stage file: ${file}`);
}
console.log('Prepared isolated home preview; private projects and attachments are excluded.');
