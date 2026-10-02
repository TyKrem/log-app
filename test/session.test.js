'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../server/lib/session.js');

test('统一会话只接受有效签名、角色和期限', () => {
  const secret = 'test-shared-session-secret-1234567890';
  const now = 1700000000000;
  for (const role of ['admin', 'read']) {
    const token = session.issue(role, secret, now);
    assert.equal(session.verify(token, secret, now), role);
    assert.equal(session.verify(token, secret, now + 12 * 60 * 60 * 1000), '');
    assert.equal(session.verify(token, 'different-secret', now), '');
    assert.equal(session.verify(token + 'bad', secret, now), '');
    assert.equal(session.cookieValue('x=1; tykrem_session=' + token), token);
  }
  assert.equal(session.verify('', secret, now), '');
});
