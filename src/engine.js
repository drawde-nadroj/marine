const clean = value => typeof value === 'string' ? value.trim() : '';

function stableHash(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateInquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Inquiry must be an object.');
  if (!clean(input.eventId)) throw new TypeError('Inquiry eventId is required.');
  if (!clean(input.message)) throw new TypeError('Inquiry message is required.');
  if (!input.sender || typeof input.sender !== 'object') throw new TypeError('Inquiry sender metadata is required.');
}

export function processInquiry(input, config) {
  validateInquiry(input);
  if (!config?.exampleDemoRules || !config?.publicBusinessFacts) throw new TypeError('Valid business rules are required.');

  const rules = config.exampleDemoRules;
  const searchable = `${clean(input.subject)} ${clean(input.message)}`.toLowerCase();
  const matches = Object.entries(rules.serviceKeywords).map(([group, terms]) => ({
    group,
    terms: terms.filter(term => searchable.includes(term.toLowerCase()))
  })).filter(match => match.terms.length);
  const urgentTerms = rules.urgentTerms.filter(term => searchable.includes(term.toLowerCase()));
  const serviceGroup = matches.sort((a, b) => b.terms.length - a.terms.length || a.group.localeCompare(b.group))[0]?.group ?? 'unclassified';
  const extracted = {
    contactName: clean(input.sender.name), organization: clean(input.sender.organization),
    email: clean(input.sender.email), phone: clean(input.sender.phone), location: clean(input.location),
    preferredContact: clean(input.preferredContact), requestSummary: clean(input.subject) || clean(input.message),
    photos: /photos?\s+(?:are\s+)?(?:available|attached|included)/i.test(input.message) ? 'Available' : '',
    siteAccess: /site access[^.;]*/i.exec(input.message)?.[0] ?? ''
  };
  const missingRequired = rules.requiredFields.filter(field => !extracted[field]);
  const missingUseful = rules.usefulProjectFields.filter(field => !extracted[field]);
  const humanRequired = rules.handoff.urgentRequiresHuman && urgentTerms.length > 0;
  const finalState = humanRequired ? 'HUMAN_REQUIRED' : missingRequired.length ? 'CLARIFICATION_NEEDED' : missingUseful.length ? 'INTAKE_READY_WITH_FOLLOW_UP' : 'INTAKE_READY';
  const correlationId = `CF-${stableHash(`${input.eventId}|${config.version}`)}`;
  const sideEffect = {attempted: false, crmWrite: false, messageSent: false, reason: humanRequired ? 'Suppressed: human decision required.' : 'Preview only: mocked systems are not connected.'};
  const requestedFields = [...missingRequired, ...missingUseful].map(field => field === 'siteAccess' ? 'site access details' : field);
  const draft = humanRequired
    ? `HUMAN REVIEW NOTE: Confirm safety, scope, and response before any reply.${requestedFields.length ? ` Intake gaps: ${requestedFields.join(' and ')}.` : ''} Do not promise availability or feasibility.`
    : `Draft clarification: Thank you for the details about ${extracted.requestSummary}. Could you share ${requestedFields.join(' and ') || 'any other useful site details'}? This demo does not confirm pricing, feasibility, or availability.`;
  const trace = [
    ['1', 'VALIDATE_INPUT', 'Deterministic input validation passed'],
    ['2', 'EXTRACT_FIELDS', 'Copied metadata and applied explicit text patterns'],
    ['3', 'CLASSIFY_SERVICE', matches.length ? `Matched: ${matches.flatMap(m => m.terms).join(', ')}` : 'No configured keyword matched'],
    ['4', 'CHECK_REQUIRED_FIELDS', [...missingRequired, ...missingUseful].length ? `Missing: ${[...missingRequired, ...missingUseful].join(', ')}` : 'No configured fields missing'],
    ['5', 'APPLY_HANDOFF_RULE', humanRequired ? `Urgent terms: ${urgentTerms.join(', ')}` : 'No urgent term matched'],
    ['6', 'FINALIZE_PREVIEW', finalState]
  ].map(([order, step, detail]) => ({eventId: `${correlationId}-${order}`, order: Number(order), step, detail}));

  return {correlationId, eventId: input.eventId, ruleVersion: config.version, original: input, extracted,
    classification: {serviceGroup, matches, urgentTerms}, missing: {required: missingRequired, useful: missingUseful},
    intakeRecord: {...extracted, serviceGroup, sourceEventId: input.eventId, status: finalState},
    finalState, humanRequired, proposedAction: humanRequired ? 'Stop automation and route to a qualified human.' : `Review the intake record and request the ${missingRequired.length ? 'required and useful' : 'useful'} missing information.`,
    draft, sideEffect, trace};
}
