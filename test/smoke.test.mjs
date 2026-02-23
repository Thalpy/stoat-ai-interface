import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = '/Users/admin/.openclaw/workspace/projects/stoat-ai-interface';

test('package.json exposes required plugin metadata', async () => {
  const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);

  assert.equal(pkg.name, '@clawdbot/stoat');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.clawdbot);
  assert.ok(Array.isArray(pkg.clawdbot.extensions));
  assert.ok(pkg.clawdbot.extensions.includes('./index.ts'));
  assert.ok(Array.isArray(pkg.clawdbot.channels));
  assert.ok(pkg.clawdbot.channels.includes('stoat'));
});

test('plugin manifest declares stoat channel plugin', async () => {
  const raw = await fs.readFile(path.join(ROOT, 'clawdbot.plugin.json'), 'utf8');
  const manifest = JSON.parse(raw);

  assert.ok(manifest);
  assert.equal(manifest.id, 'stoat');
  assert.ok(Array.isArray(manifest.channels));
  assert.ok(manifest.channels.includes('stoat'));
});
