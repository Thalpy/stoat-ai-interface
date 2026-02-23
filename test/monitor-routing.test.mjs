import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldProcessInboundMessage } from '../routing.ts';

test('blocks self messages', () => {
  assert.equal(
    shouldProcessInboundMessage({ isSelf: true, isSystem: false, isDM: true, isMentioned: false }),
    false,
  );
});

test('blocks system messages', () => {
  assert.equal(
    shouldProcessInboundMessage({ isSelf: false, isSystem: true, isDM: true, isMentioned: false }),
    false,
  );
});

test('allows DMs without mention', () => {
  assert.equal(
    shouldProcessInboundMessage({ isSelf: false, isSystem: false, isDM: true, isMentioned: false }),
    true,
  );
});

test('allows channel messages only when mentioned', () => {
  assert.equal(
    shouldProcessInboundMessage({ isSelf: false, isSystem: false, isDM: false, isMentioned: false }),
    false,
  );
  assert.equal(
    shouldProcessInboundMessage({ isSelf: false, isSystem: false, isDM: false, isMentioned: true }),
    true,
  );
});
