import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoatClientInit } from '../client-init.ts';

test('buildStoatClientInit maps apiUrl and wsUrl to stoat.js constructor args', () => {
  const result = buildStoatClientInit('https://example.com/api', 'wss://example.com/ws');

  assert.deepEqual(result.clientOptions, { baseURL: 'https://example.com/api' });
  assert.deepEqual(result.websocketOptions, { ws: 'wss://example.com/ws' });
});

test('buildStoatClientInit omits websocket options when wsUrl is absent', () => {
  const result = buildStoatClientInit('https://example.com/api');

  assert.deepEqual(result.clientOptions, { baseURL: 'https://example.com/api' });
  assert.equal(result.websocketOptions, undefined);
});
