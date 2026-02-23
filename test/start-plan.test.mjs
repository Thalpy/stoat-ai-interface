import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStoatStartPlan } from '../start-plan.ts';

test('buildStoatStartPlan returns dry-run startup plan without network calls', () => {
  const abortController = new AbortController();
  const runtime = { env: 'test' };
  const ctx = {
    cfg: { channels: { stoat: {} } },
    runtime,
    abortSignal: abortController.signal,
    account: {
      accountId: 'default',
      token: '  token-123  ',
      config: {
        apiUrl: 'https://stoat.example/api',
        mediaMaxMb: 12,
        historyLimit: 42,
      },
    },
  };

  const plan = buildStoatStartPlan(ctx);

  assert.equal(plan.token, 'token-123');
  assert.equal(plan.accountId, 'default');
  assert.equal(plan.apiUrl, 'https://stoat.example/api');
  assert.equal(plan.mediaMaxMb, 12);
  assert.equal(plan.historyLimit, 42);
  assert.equal(plan.runtime, runtime);
  assert.equal(plan.abortSignal, abortController.signal);
  assert.deepEqual(plan.config, { channels: { stoat: {} } });
});

test('buildStoatStartPlan throws when account token is missing', () => {
  const ctx = {
    cfg: {},
    runtime: {},
    account: {
      accountId: 'default',
      token: '   ',
      config: {},
    },
  };

  assert.throws(
    () => buildStoatStartPlan(ctx),
    /Stoat bot token missing for account "default"/
  );
});
