import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ACCOUNT_ID,
  listAccountIds,
  resolveAccount,
} from '../config.ts';

test('listAccountIds includes default and named accounts', () => {
  const cfg = {
    channels: {
      stoat: {
        token: 'base-token',
        accounts: {
          team: { token: 'team-token' },
        },
      },
    },
  };

  const ids = listAccountIds(cfg);
  assert.deepEqual(ids.sort(), [DEFAULT_ACCOUNT_ID, 'team'].sort());
});

test('resolveAccount merges named account with top-level defaults', () => {
  const cfg = {
    channels: {
      stoat: {
        apiUrl: 'https://stoat.example/api',
        wsUrl: 'wss://stoat.example/ws',
        dm: { policy: 'allowlist', allowFrom: ['Alice'] },
        mediaMaxMb: 8,
        accounts: {
          team: {
            token: 'team-token',
            name: 'Team Bot',
            historyLimit: 50,
          },
        },
      },
    },
  };

  const account = resolveAccount(cfg, 'team');
  assert.equal(account.accountId, 'team');
  assert.equal(account.token, 'team-token');
  assert.equal(account.config.apiUrl, 'https://stoat.example/api');
  assert.equal(account.config.wsUrl, 'wss://stoat.example/ws');
  assert.equal(account.config.mediaMaxMb, 8);
  assert.equal(account.config.historyLimit, 50);
  assert.deepEqual(account.config.dm, { policy: 'allowlist', allowFrom: ['Alice'] });
});

test('resolveAccount falls back to disabled account when unknown', () => {
  const cfg = { channels: { stoat: { token: 'base-token' } } };
  const account = resolveAccount(cfg, 'missing');

  assert.equal(account.accountId, 'missing');
  assert.equal(account.enabled, false);
  assert.deepEqual(account.config, {});
});
