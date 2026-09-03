import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { processInquiry, validateInquiry } from '../src/engine.js';

const loadJson = relativePath => JSON.parse(
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')
);

const config = loadJson('../config/business-rules.json');
const happyInquiry = loadJson('../fixtures/happy-path.json');
const emergencyInquiry = loadJson('../fixtures/handoff.json');

test('happy inquiry classifies infrastructure, requests useful missing info, and needs no handoff', () => {
  const result = processInquiry(happyInquiry, config);

  assert.equal(result.classification.serviceGroup, 'infrastructure');
  assert.deepEqual(result.missing.required, []);
  assert.deepEqual(result.missing.useful, ['photos', 'siteAccess']);
  assert.equal(result.finalState, 'INTAKE_READY_WITH_FOLLOW_UP');
  assert.equal(result.humanRequired, false);
  assert.match(result.draft, /photos and site access details/i);
});

test('missing required metadata is included in the clarification draft', () => {
  const inquiry = { ...happyInquiry, sender: { ...happyInquiry.sender, email: '' } };
  const result = processInquiry(inquiry, config);

  assert.equal(result.finalState, 'CLARIFICATION_NEEDED');
  assert.deepEqual(result.missing.required, ['email']);
  assert.match(result.draft, /email/i);
  assert.match(result.proposedAction, /required and useful missing information/i);
});

test('emergency inquiry requires a human without an availability promise or side effects', () => {
  const result = processInquiry(emergencyInquiry, config);

  assert.equal(result.classification.serviceGroup, 'utilities');
  assert.equal(result.finalState, 'HUMAN_REQUIRED');
  assert.equal(result.humanRequired, true);
  assert.match(result.proposedAction, /route to a qualified human/i);
  assert.match(result.draft, /do not promise availability or feasibility/i);
  assert.doesNotMatch(result.draft, /(?:we|coastal flow) (?:are|will be|can be) available/i);
  assert.deepEqual(result.sideEffect, {
    attempted: false,
    crmWrite: false,
    messageSent: false,
    reason: 'Suppressed: human decision required.'
  });
});

test('emergency handoff note preserves visible intake gaps', () => {
  const inquiry = { ...emergencyInquiry, sender: { ...emergencyInquiry.sender, email: '' } };
  const result = processInquiry(inquiry, config);

  assert.equal(result.finalState, 'HUMAN_REQUIRED');
  assert.match(result.draft, /intake gaps: email/i);
  assert.equal(result.sideEffect.attempted, false);
});

test('input validation rejects malformed inquiries and invalid business rules', async t => {
  const invalidInquiries = [
    ['non-object inquiry', null, 'Inquiry must be an object.'],
    ['missing eventId', { ...happyInquiry, eventId: ' ' }, 'Inquiry eventId is required.'],
    ['missing message', { ...happyInquiry, message: '' }, 'Inquiry message is required.'],
    ['missing sender metadata', { ...happyInquiry, sender: null }, 'Inquiry sender metadata is required.']
  ];

  for (const [name, inquiry, message] of invalidInquiries) {
    await t.test(name, () => {
      assert.throws(() => validateInquiry(inquiry), { name: 'TypeError', message });
    });
  }

  await t.test('invalid business rules', () => {
    assert.throws(
      () => processInquiry(happyInquiry, {}),
      { name: 'TypeError', message: 'Valid business rules are required.' }
    );
  });
});

test('processing the same inquiry and rules is repeatable', () => {
  const first = processInquiry(happyInquiry, config);
  const second = processInquiry(happyInquiry, config);

  assert.deepEqual(second, first);
  assert.equal(first.correlationId, second.correlationId);
  assert.equal(new Set(first.trace.map(item => item.eventId)).size, first.trace.length);
  assert.ok(first.trace.every(item => item.eventId.startsWith(first.correlationId)));
});
