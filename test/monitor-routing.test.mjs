import test from 'node:test';
import assert from 'node:assert/strict';
import { messageMentionsBot, shouldProcessInboundMessage } from '../routing.ts';

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

test('detects mentions from mentionIds and both mention text formats', () => {
  const botUserId = '01BOTIDABC123';

  assert.equal(messageMentionsBot({ text: 'hi', botUserId, mentionIds: ['x', botUserId] }), true);
  assert.equal(messageMentionsBot({ text: `hello <@${botUserId}>`, botUserId }), true);
  assert.equal(messageMentionsBot({ text: `hello <@!${botUserId}>`, botUserId }), true);
  assert.equal(messageMentionsBot({ text: 'hello there', botUserId }), false);
});
