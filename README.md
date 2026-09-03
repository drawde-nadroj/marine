# Coastal Flow marine inquiry intake demo

A zero-dependency, local BUILD-mode demonstration. It shows how one unstructured marine-construction inquiry can become a transparent intake record without AI, external systems, or automated business commitments.

> **These are example rules and sample data. The important part is that this same structure can be configured around the way your business actually works.**

## Business problem proved

Incoming project inquiries contain useful facts in prose. A person must classify the work, find gaps, decide what happens next, and recognize cases that require judgment. This demo makes those steps visible and repeatable while keeping emergency response, feasibility, pricing, and availability with a human.

The employee no longer has to remember to perform the first-pass intake checks because selecting a sample inquiry now triggers the same configured validation, classification, missing-field check, and handoff rule automatically. Connecting a real submission trigger is outside this demo.

## Flow

```text
MOCKED inquiry
  → deterministic validation and extraction
  → REAL service-category match using EXAMPLE keyword rules
  → EXAMPLE required/useful-field checks
  → routine clarification preview OR HUMAN-REQUIRED emergency stop
  → visible record and ordered trace (no send and no CRM write)
```

## Prerequisites

- Python 3 for the local static server
- Node.js 26 for tests
- A modern browser

No package install, database, n8n, credential, external network request, or external service is needed. The page makes localhost requests only for its bundled files after the server starts.

## Setup and run

From this directory:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Select **Routine repair inquiry** or **Emergency utility failure** as often as needed. Stop the server with `Ctrl-C`.

Opening `index.html` directly is unsupported because browsers restrict local JSON fetches. Use the server command above.

## Sample inputs and expected outcomes

### Routine repair inquiry

A mocked Harbor Point Marina request reports worn pile guides and unusual dock movement in St. Petersburg, Florida. Sender metadata and preferred contact are present.

Expected result:

- classification: `infrastructure`, with `pile guide`, `pile guides`, and `dock movement` exposed as matched terms;
- required intake fields complete;
- photos and site-access details shown as useful missing information;
- final state: `INTAKE_READY_WITH_FOLLOW_UP`;
- a clarification draft that makes no price, feasibility, or availability claim;
- no handoff, send, or CRM write.

### Emergency handoff

A mocked Bay Haven Marina request reports a marina water-main failure and outage in Miami, Florida.

Expected result:

- classification: `utilities`, with matched service and urgent terms exposed;
- final state: `HUMAN_REQUIRED` under a clearly labeled **EXAMPLE DEMO RULE**;
- automation stops and asks a qualified human to decide the response;
- the note explicitly prohibits availability and feasibility promises;
- message send and CRM write remain suppressed.

## REAL vs MOCKED vs UNKNOWN

### REAL — public business facts

The configuration and UI identify these as public facts supplied for the demo:

- Coastal Flow Marine describes two disciplines: **Marine Utility Specialists** and **Marina Repairs & Infrastructure**.
- Public services represented in the configuration include potable water systems and marina water mains; sewer/wastewater and pump-out piping; HDPE/PVC/PEX and specialty marine piping; backflow/valve systems; emergency water/sewer repairs; pile guide repair/replacement; gangway repair/replacement; decking/dock hardware; utility chase/piping; dock water/sewer connections; and marina maintenance/emergency repairs.
- The public website describes the company as Florida-based and says it travels for specialized projects. This public service-area statement does not establish availability for a specific project. Public customer categories include marinas, yacht clubs, waterfront properties, marine contractors, municipalities, and commercial facilities.

Sources (provided by the user and displayed in the app):

- https://coastalflowmarine.com/
- https://coastalflowmarine.com/services
- https://coastalflowmarine.com/infrastructure

No prospect logo or copied site asset is used.

### MOCKED

The inquiries, people, organizations, contact details, timestamps, intake record, draft, CRM boundary, message boundary, and execution result are sample demo data. `.example` email domains and `555` telephone numbers reinforce this boundary. No side effect exists.

### UNKNOWN

The actual CRM, inbox/form, pricing, availability, estimating criteria, internal sales stages, and response policy require business discovery. The demo does not infer them.

## Configuration points

Edit `config/business-rules.json` to demonstrate a confirmed process:

- `publicBusinessFacts` contains **REAL** sourced facts.
- `exampleDemoRules.serviceKeywords` maps explicit terms to service groups.
- `requiredFields` and `usefulProjectFields` control gap checks.
- `urgentTerms` and `handoff` control the **EXAMPLE DEMO RULE** stop.
- `unknownOperationalData` keeps discovery gaps visible.
- `version` changes the visible rule version and deterministic correlation ID.

Keep public facts separate from example policy. A production configuration should be approved and maintained by the business owner.

## Verification

Run the automated checks:

```bash
node --test
# or: npm test
```

The tests cover routine classification, useful missing information, absence of handoff, emergency classification, mandatory human handoff, absence of an availability promise and side effects, malformed input, and deterministic repeatability.

For a browser smoke check:

1. Start `python3 -m http.server 8000`.
2. Open `http://localhost:8000/`.
3. Confirm the routine example shows `INTAKE READY WITH FOLLOW UP` and missing photos/site access.
4. Confirm the emergency example shows `HUMAN REQUIRED`, an automation stop, and `CRM write: NO • Message sent: NO`.
5. Switch back and confirm the same correlation ID and ordered result return.
6. Narrow the viewport and confirm cards stack, buttons remain reachable by keyboard, and focus is visible.

## 30–90 second prospect-facing narrative

| Step | What to show | What to say | Business problem demonstrated |
|---|---|---|---|
| 1 | Boundary legend and central message | “This uses public facts, sample inquiries, and example policy. The structure is configurable to your process.” | Honest scope and low integration risk |
| 2 | Routine inquiry | “A marina describes worn pile guides and dock movement in normal email-style prose.” | Unstructured intake |
| 3 | Extracted fields and matched terms | “The same deterministic rules copy known fields and show exactly why this maps to infrastructure work.” | Repetitive classification and transcription |
| 4 | Missing information and intake record | “Required contact data is ready, while photos and site access remain visible follow-ups.” | Incomplete inquiries and inconsistent checks |
| 5 | Draft and trace | “The next step is a preview only. Every step has an event ID and rule version.” | Auditability without premature automation |
| 6 | Emergency example | “An outage matches an example urgent rule, stops automation, and sends nothing. A human owns the response.” | Unsafe commitments and exception handling |

## Prospect-specific details used

- The two public discipline names.
- The public marine utility and marina infrastructure service families.
- Florida base, travel statement, and public customer categories.
- Marine-specific sample language: pile guides, dock movement, marina water main, valve, occupied slips, and site access.

## Reusable assets

- **Generally reusable:** deterministic engine shape, validation, missing-field checks, trace, side-effect suppression, fixture runner, responsive presentation shell.
- **Industry-specific:** marine inquiry field vocabulary and service keyword model.
- **Customer-specific:** public facts, approved keywords, required fields, urgent policy, handoff owner, response language, and system adapters.

## What not to show or claim

Do not present the draft as sent, the intake record as a real CRM record, or the example rules as Coastal Flow Marine policy. Do not claim pricing, feasibility, availability, response time, production readiness, private access, AI capability, or integration support. Do not open developer tooling during the short prospect narrative unless technical evidence is requested.

## Limitations

- Deterministic phrase matching handles only configured wording. It is intentionally not semantic AI extraction.
- Fixture metadata supplies contact fields; the engine does not parse arbitrary email headers or attachments.
- The demo has no authentication, persistence, deduplication store, inbox listener, CRM adapter, send adapter, monitoring, or business-approved policy.
- The trace is generated locally and is not a production audit log.
- Browser interaction is a preview. Refreshing loses all state.

## Concise production bridge

After discovery and separate authorization, map the real inquiry source and CRM contracts; obtain business approval for fields, service mappings, urgent criteria, response policy, and handoff ownership; add schema validation at each external boundary; persist idempotency and audit state; authenticate least-privilege adapters; verify writes and sends from authoritative responses; and add retry, reconciliation, monitoring, privacy, and operational tests. Keep high-impact emergency, feasibility, price, and availability decisions human-owned unless the business establishes an authoritative decision source and explicit authorization.
# marine
