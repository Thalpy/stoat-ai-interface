import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function readJson(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  const content = await readFile(fullPath, 'utf8');
  return JSON.parse(content);
}

test('plugin manifest and package metadata expose stoat channel entrypoints', async () => {
  const [manifest, pkg] = await Promise.all([
    readJson('clawdbot.plugin.json'),
    readJson('package.json'),
  ]);

  assert.equal(manifest.id, 'stoat');
  assert.ok(Array.isArray(manifest.channels));
  assert.ok(manifest.channels.includes('stoat'));

  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'index.ts');
  assert.ok(pkg.clawdbot);
  assert.ok(Array.isArray(pkg.clawdbot.extensions));
  assert.ok(pkg.clawdbot.extensions.includes('./index.ts'));
  assert.ok(Array.isArray(pkg.clawdbot.channels));
  assert.ok(pkg.clawdbot.channels.includes('stoat'));
});

test('index.ts exposes expected plugin exports and ids', async () => {
  const indexSource = await readFile(path.join(projectRoot, 'index.ts'), 'utf8');

  assert.match(indexSource, /const\s+stoatPlugin\s*=\s*\{/);
  assert.match(indexSource, /id:\s*["']stoat["']/);
  assert.match(indexSource, /export\s+default\s+function\s+register\s*\(/);
  assert.match(indexSource, /export\s*\{\s*stoatPlugin\s*\}/);
  assert.match(indexSource, /api\.registerChannel\(\{\s*plugin:\s*stoatPlugin\s*\}\)/);
});
