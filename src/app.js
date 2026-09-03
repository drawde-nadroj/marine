import { processInquiry } from './engine.js';

const $ = id => document.getElementById(id);
let config;
let fixtures;

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list = items => items.length ? `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p>None</p>';
const fieldLabel = field => ({
  contactName: 'Contact name', organization: 'Organization', email: 'Email', phone: 'Phone',
  location: 'Location', preferredContact: 'Preferred contact', requestSummary: 'Request summary',
  photos: 'Photos', siteAccess: 'Site access details'
})[field] ?? field;

function render(name) {
  const result = processInquiry(fixtures[name], config);
  $('results').hidden = false;
  $('happy').classList.toggle('active', name === 'happy');
  $('happy').setAttribute('aria-pressed', String(name === 'happy'));
  $('handoff').classList.toggle('active', name === 'handoff');
  $('handoff').setAttribute('aria-pressed', String(name === 'handoff'));
  $('status').textContent = `${name === 'happy' ? 'Routine' : 'Emergency'} example completed. No external side effect occurred.`;
  $('meta').textContent = `${result.original.sender.name} • ${result.original.sender.organization} • ${result.original.location} • prefers ${result.original.preferredContact}`;
  $('subject').textContent = result.original.subject;
  $('inquiry').textContent = result.original.message;
  $('state').textContent = result.finalState.replaceAll('_', ' ');
  $('stateLabel').textContent = result.humanRequired ? 'AUTOMATION STOP' : 'DETERMINISTIC RESULT';
  $('stateLabel').className = `label ${result.humanRequired ? 'stop' : 'real'}`;
  $('action').textContent = result.proposedAction;
  $('correlation').textContent = result.correlationId; $('version').textContent = result.ruleVersion;
  $('fields').innerHTML = Object.entries(result.extracted).map(([key,value]) => `<div><dt>${escape(fieldLabel(key))}</dt><dd>${escape(value || 'Not found')}</dd></div>`).join('');
  const serviceLabel = config.publicBusinessFacts.serviceGroups.find(group => group.id === result.classification.serviceGroup)?.label ?? 'Unclassified request';
  const matched = result.classification.matches.flatMap(match => match.terms.map(term => `${serviceLabel}: “${term}”`));
  $('rules').innerHTML = `<span class="label real">REAL SERVICE CATEGORY</span>${list([serviceLabel])}<span class="label example">EXAMPLE DEMO RULE</span><p><strong>Matched terms</strong></p>${list(matched)}<p><strong>Urgent terms</strong></p>${list(result.classification.urgentTerms)}`;
  $('missing').innerHTML = `<p><strong>Required</strong></p>${list(result.missing.required.map(fieldLabel))}<p><strong>Useful follow-up</strong></p>${list(result.missing.useful.map(fieldLabel))}`;
  $('record').textContent = JSON.stringify(result.intakeRecord, null, 2);
  $('draft').textContent = result.draft;
  $('decision').classList.toggle('handoff-card', result.humanRequired);
  $('effects').innerHTML = `<p><strong>Side effects:</strong> CRM write: NO • Message sent: NO</p><p>${escape(result.sideEffect.reason)}</p>`;
  $('trace').innerHTML = result.trace.map(item => `<li><span>${item.order}</span><div><strong>${escape(item.step)}</strong><p>${escape(item.detail)}</p><small>Event ${escape(item.eventId)}</small></div></li>`).join('');
}

async function start() {
  try {
    const [rules, happy, handoff] = await Promise.all(['config/business-rules.json','fixtures/happy-path.json','fixtures/handoff.json'].map(path => fetch(path).then(response => {
      if (!response.ok) throw new Error(`Could not load ${path}`); return response.json();
    })));
    config = rules; fixtures = {happy, handoff};
    $('facts').innerHTML = `<p><strong>${escape(config.publicBusinessFacts.disciplines.join(' + '))}</strong></p><p>${escape(config.publicBusinessFacts.locationStatement)}</p><p>Services represented in configured categories.</p>${list(config.publicBusinessFacts.sources.map(source => source))}`;
    $('unknowns').innerHTML = config.unknownOperationalData.map(item => `<li>${escape(item)}</li>`).join('');
    $('happy').disabled = false;
    $('handoff').disabled = false;
    render('happy');
  } catch (error) { $('status').textContent = `Demo could not load: ${error.message}. Serve the folder over HTTP; do not open index.html directly.`; }
}
$('happy').addEventListener('click', () => render('happy'));
$('handoff').addEventListener('click', () => render('handoff'));
start();
