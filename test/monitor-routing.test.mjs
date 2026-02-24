import test from 'node:test';
import assert from 'node:assert/strict';
import {
  messageMentionsBot,
  messageRepliesToBot,
  shouldProcessInboundMessage,
} from '../routing.ts';

test('mention trigger: channel messages are processed when bot is mentioned', () => {
  const botUserId = '01BOTIDABC123';

  assert.equal(
    messageMentionsBot({ text: 'hey <@01BOTIDABC123>', botUserId }),
    true,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: false,
      isDM: false,
      isMentioned: true,
      isReplyToBot: false,
    }),
    true,
  );
});

test('reply trigger: channel messages are processed when replying to a known bot message', () => {
  const knownBotMessageIds = ['01HISBOTMSG0001', '01HISBOTMSG0002'];

  assert.equal(
    messageRepliesToBot({
      replyIds: ['01HISBOTMSG0002'],
      knownBotMessageIds,
    }),
    true,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: false,
      isDM: false,
      isMentioned: false,
      isReplyToBot: true,
    }),
    true,
  );
});

test('non-trigger noise: busy group-chat chatter without mention/reply is ignored', () => {
  assert.equal(
    messageRepliesToBot({
      replyIds: ['01SOMEONEELSEMSG'],
      knownBotMessageIds: ['01BOTMSG'],
    }),
    false,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: false,
      isDM: false,
      isMentioned: false,
      isReplyToBot: false,
    }),
    false,
  );
});

test('regression: existing ping behavior still works across mention ID and text formats', () => {
  const botUserId = '01BOTIDABC123';

  assert.equal(messageMentionsBot({ text: 'hi', botUserId, mentionIds: ['x', botUserId] }), true);
  assert.equal(messageMentionsBot({ text: `hello <@${botUserId}>`, botUserId }), true);
  assert.equal(messageMentionsBot({ text: `hello <@!${botUserId}>`, botUserId }), true);
  assert.equal(messageMentionsBot({ text: 'hello there', botUserId }), false);
});

test('failure-path handling: malformed reply metadata fails closed (no throw, no trigger)', () => {
  assert.doesNotThrow(() => {
    assert.equal(
      messageRepliesToBot({
        // malformed / unexpected payloads
        replyIds: [null, 42, { nope: true }, { id: 9 }, { id: '01REAL' }],
        knownBotMessageIds: ['01OTHER'],
      }),
      false,
    );
  });

  assert.equal(
    messageRepliesToBot({ replyIds: undefined, knownBotMessageIds: undefined }),
    false,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: false,
      isDM: false,
      isMentioned: false,
      isReplyToBot: false,
    }),
    false,
  );
});

test('existing guardrails remain: self/system blocked, DM allowed without ping', () => {
  assert.equal(
    shouldProcessInboundMessage({
      isSelf: true,
      isSystem: false,
      isDM: true,
      isMentioned: false,
      isReplyToBot: false,
    }),
    false,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: true,
      isDM: true,
      isMentioned: false,
      isReplyToBot: false,
    }),
    false,
  );

  assert.equal(
    shouldProcessInboundMessage({
      isSelf: false,
      isSystem: false,
      isDM: true,
      isMentioned: false,
      isReplyToBot: false,
    }),
    true,
  );
});
