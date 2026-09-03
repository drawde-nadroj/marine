import { activeProspectSlug, loadProspect } from "../config.ts";
import {
  makeResult,
  normalizeInquiry,
  payloadHash,
  validateInquiry,
} from "../domain/inquiry.ts";
import { DeterministicInquiryInterpreter } from "../interpreters/deterministic.ts";
import { MockMessageAdapter } from "../messaging/mock.ts";
import { Store } from "../store/database.ts";
export class AutomationService {
  store: Store;
  private interpreter: DeterministicInquiryInterpreter;
  private messaging: MockMessageAdapter;
  constructor(
    store: Store,
    interpreter = new DeterministicInquiryInterpreter(),
    messaging = new MockMessageAdapter(),
  ) {
    this.store = store;
    this.interpreter = interpreter;
    this.messaging = messaging;
  }
  intake(raw: unknown) {
    validateInquiry(raw);
    const slug = activeProspectSlug();
    const config = loadProspect(slug);
    const input = normalizeInquiry(raw);
    const hash = payloadHash(input);
    const existing = this.store.findLead(slug, input.eventId);
    if (existing) {
      if (existing.payload_hash !== hash) {
        const error: any = new Error(
          "Conflicting duplicate: this prospect and external event ID already have a different payload.",
        );
        error.code = "IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return this.store.leadView(existing, true);
    }
    const interpretation = this.interpreter.interpret(input, config);
    const result = makeResult(input, config, interpretation);
    const due = result.needsInformation && !result.humanRequired
      ? new Date(
        Date.now() + config.EXAMPLE_SIMULATED.followupDelaySeconds * 1000,
      ).toISOString()
      : null;
    const id = this.store.createLead(slug, input, hash, result, due);
    return this.store.leadView(
      this.store.findLead(slug, input.eventId)!,
      false,
    );
  }
  runFollowups() {
    const slug = activeProspectSlug();
    const claimed = this.store.claimDue(slug);
    const results = [];
    for (const id of claimed) {
      const action = this.store.actionForExecution(id);
      if (!action) {
        results.push({ actionId: id, state: "CANCELED_OR_INVALID" });
        continue;
      }
      const input = JSON.parse(action.input_json);
      const body =
        `Simulated request for missing information. ${input.message}`;
      const sent = this.messaging.send(body);
      results.push(
        this.store.finishAction(action, sent.status, body, sent.error),
      );
    }
    return { claimed: claimed.length, results };
  }
  update(leadId: number) {
    return this.store.markInformationReceived(leadId, activeProspectSlug());
  }
}
