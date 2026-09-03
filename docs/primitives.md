# Proven primitives

Node owns every domain primitive. n8n only triggers commands and routes returned state. `PROSPECT_SLUG` is the validated server-side selector. The scenario API lists and loads only fixture files declared by that active prospect.

| Primitive | Input → output | State owner / side effects | Failures and idempotency | Customer configuration |
|---|---|---|---|---|
| `lead.normalize/validate/classify/missing_fields/persist` | Inquiry + active prospect config → persisted lead result | Node rules; SQLite lead and intake execution | Malformed input writes nothing. `(prospect_slug, external_event_id)` plus payload hash replays identical input and rejects conflicts. | Public service labels; simulated required/useful fields, keyword groups, urgent terms |
| `followup.create` | Needs-information lead → `PENDING` action with `due_at` | SQLite scheduled action | Unique stable `lead:{id}:missing-info-v1` key | Demo delay and label |
| `followup.cancel` | Valid customer update → ready lead + `CANCELED` safe action | SQLite transaction | Accepts only a `NEEDS_INFORMATION` lead with an active `REQUEST_INFORMATION` action; other states reject without mutation | None |
| `followup.claim_due` | Current time → claimed IDs | SQLite `BEGIN IMMEDIATE` transaction | Rechecks pending state and lead validity; one claim wins | None |
| `followup.execute` | Claimed valid action → `EXECUTED` or `FAILED` | Node mock adapter; SQLite action, execution, message event | Rechecks lead before the synchronous mock send; a canceled claim cannot record late completion; terminal state prevents replay | Mock failure marker is DEMO-ONLY |
| `workflow.trace/idempotency/escalate` | Interpreted intake → ordered trace and route | Node result plus persisted execution history; n8n visibly switches on it | Trace is deterministic; urgent route suppresses follow-up | Urgent terms |
| `conversation.handoff` | Human-required lead → open handoff | SQLite handoff | One handoff per lead | Actual owner is unknown |
| mock messaging | Text → `SIMULATED`/`FAILED` | Local adapter and SQLite only | `DEMO_FAIL_MESSAGE` injects explicit failure; no network send | Not production-configurable |

The deterministic result carries each service category's configured provenance. Sourced Coastal categories use `PUBLICLY_VERIFIED`; unclassified and scaffold categories use `EXAMPLE_SIMULATED`. Keyword and policy application is always labeled `EXAMPLE_SIMULATED`. A verified category label does not verify the matching rule.

## Future interpreter extension

`InquiryInterpreter` is deliberately narrow: `interpret(inquiry, prospectConfig) → interpretation`. A future AI interpreter must preserve validation, persistence, idempotency, and state ownership in Node. It must return the same contract, expose uncertainty, and receive separate authorization. No AI is used now.
