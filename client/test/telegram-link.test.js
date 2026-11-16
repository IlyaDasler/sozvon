const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTelegramBotLink } = require('../renderer/telegram-link');

const link = 'https://t.me/sozvon_bot?start=phone-reset_1234567890123456';

test('accepts only a canonical Telegram bot link matching the server bot name and carrying one opaque start token', () => {
  assert.equal(validateTelegramBotLink(link, 'sozvon_bot'), link);
  assert.equal(validateTelegramBotLink('https://t.me/SOZVON_BOT?start=phone-reset_1234567890123456', 'sozvon_bot'),
    'https://t.me/SOZVON_BOT?start=phone-reset_1234567890123456');
});

test('rejects schemes, hosts, usernames, path tricks, and credentials outside the Telegram bot contract', () => {
  for (const raw of [
    link.replace('https:', 'http:'), link.replace('t.me', 'telegram.me'),
    link.replace('sozvon_bot', 'attacker_bot'), link.replace('https://', 'https://user@'),
    link.replace('t.me/', 't.me:444/'), link.replace('/sozvon_bot?', '/sozvon_bot/extra?'),
    `${link}&redirect=https://example.invalid`, `${link}#fragment`,
  ]) assert.equal(validateTelegramBotLink(raw, 'sozvon_bot'), '', raw);
  assert.equal(validateTelegramBotLink(link, 'other_bot'), '');
});

test('rejects malformed, duplicate, too-short, and overlong start tokens', () => {
  for (const raw of [
    'https://t.me/sozvon_bot', 'https://t.me/sozvon_bot?start=short',
    'https://t.me/sozvon_bot?start=phone-reset_1234567890123456&start=second_token_123456',
    `https://t.me/sozvon_bot?start=${'x'.repeat(65)}`,
    ` https://t.me/sozvon_bot?start=${'x'.repeat(24)}`,
  ]) assert.equal(validateTelegramBotLink(raw, 'sozvon_bot'), '', raw);
});
