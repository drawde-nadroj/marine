import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { AutomationService } from "../src/service/automation.ts";
import { Store } from "../src/store/database.ts";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../prospects/coastal-flow-marine/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const open = () => new Store(":memory:");

test("complete inquiry becomes intake-ready without a follow-up or handoff", () => {
  const store = open();
  try {
    const result = new AutomationService(store).intake(fixture("complete"));
    assert.equal(result.state, "INTAKE_READY");
    assert.equal(result.needsInformation, false);
    assert.equal(
      result.classification.serviceLabel,
      "Marina Repairs & Infrastructure",
    );
    assert.equal(result.classification.categoryProvenance, "PUBLICLY_VERIFIED");
    assert.equal(result.classification.ruleProvenance, "EXAMPLE_SIMULATED");
    assert.equal(result.followup, null);
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 1,
      executions: 1,
      scheduled_actions: 0,
      handoffs: 0,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("incomplete inquiry records missing fields and creates one pending follow-up", () => {
  const store = open();
  try {
    const result = new AutomationService(store).intake(fixture("incomplete"));
    assert.equal(result.state, "NEEDS_INFORMATION");
    assert.deepEqual(result.missing.required, ["phone"]);
    assert.deepEqual(result.missing.useful, ["photos", "siteAccess"]);
    assert.equal(result.followup.state, "PENDING");
    assert.equal(result.canReceiveCustomerInformation, true);
    assert.match(result.timingLabel, /15 seconds/);
    assert.equal(store.counts("coastal-flow-marine").scheduled_actions, 1);
  } finally {
    store.close();
  }
});

test("emergency inquiry requires a human handoff and suppresses follow-up scheduling", () => {
  const store = open();
  try {
    const result = new AutomationService(store).intake(fixture("emergency"));
    assert.equal(result.state, "HUMAN_REQUIRED");
    assert.equal(result.humanRequired, true);
    assert.deepEqual(result.classification.urgentTerms, [
      "outage",
      "failure",
      "emergency",
    ]);
    assert.equal(result.followup, null);
    assert.equal(result.canReceiveCustomerInformation, false);
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 1,
      executions: 1,
      scheduled_actions: 0,
      handoffs: 1,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("identical duplicate is idempotent while conflicting duplicate is rejected", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    const input = fixture("complete");
    const first = service.intake(input);
    const duplicate = service.intake(input);
    assert.equal(duplicate.leadId, first.leadId);
    assert.equal(duplicate.duplicate, true);
    assert.throws(
      () => service.intake({ ...input, message: "Different request" }),
      (error: any) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 1,
      executions: 1,
      scheduled_actions: 0,
      handoffs: 0,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("persisted lead and duplicate identity survive database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "coastal-store-"));
  const path = join(dir, "demo.sqlite");
  try {
    const firstStore = new Store(path);
    const first = new AutomationService(firstStore).intake(
      fixture("incomplete"),
    );
    firstStore.close();
    const reopened = new Store(path);
    try {
      const duplicate = new AutomationService(reopened).intake(
        fixture("incomplete"),
      );
      assert.equal(duplicate.leadId, first.leadId);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.followup.state, "PENDING");
      assert.equal(reopened.counts("coastal-flow-marine").leads, 1);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("due follow-up is claimed once and records a simulated message", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    const intake = service.intake(fixture("incomplete"));
    store.db.prepare(
      "UPDATE scheduled_actions SET due_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(intake.followup.id);
    const run = service.runFollowups();
    assert.equal(run.claimed, 1);
    assert.deepEqual(run.results.map((x) => x.state), ["EXECUTED"]);
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 1,
      executions: 2,
      scheduled_actions: 1,
      handoffs: 0,
      message_events: 1,
    });
    assert.deepEqual(
      store.recent("coastal-flow-marine")[0].executionHistory.map((item: any) =>
        item.kind
      ),
      ["INTAKE", "FOLLOWUP"],
    );
    assert.equal(service.runFollowups().claimed, 0);
  } finally {
    store.close();
  }
});

test("customer update cancels pending follow-up before it can execute", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    const intake = service.intake(fixture("incomplete"));
    const updated = service.update(intake.leadId);
    assert.equal(updated.state, "INTAKE_READY");
    assert.equal(updated.followup.state, "CANCELED");
    assert.equal(service.runFollowups().claimed, 0);
    assert.equal(store.counts("coastal-flow-marine").message_events, 0);
  } finally {
    store.close();
  }
});

test("a canceled claimed follow-up cannot record late completion", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    const intake = service.intake(fixture("incomplete"));
    store.db.prepare(
      "UPDATE scheduled_actions SET due_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(intake.followup.id);
    const [actionId] = store.claimDue("coastal-flow-marine");
    const action = store.actionForExecution(actionId);
    service.update(intake.leadId);
    assert.equal(
      store.finishAction(action, "SIMULATED", "late result").state,
      "CANCELED_OR_INVALID",
    );
    assert.deepEqual(
      store.recent("coastal-flow-marine")[0].executionHistory.map((item: any) =>
        item.kind
      ),
      ["INTAKE", "CUSTOMER_UPDATE"],
    );
    assert.equal(store.counts("coastal-flow-marine").message_events, 0);
  } finally {
    store.close();
  }
});

test("customer update rejects human-required and intake-ready leads without mutation", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    for (const name of ["emergency", "complete"]) {
      const lead = service.intake(fixture(name));
      const before = store.leadView(
        store.findLead("coastal-flow-marine", lead.eventId)!,
      );
      assert.equal(before.canReceiveCustomerInformation, false);
      assert.throws(
        () => service.update(lead.leadId),
        (error: any) => error.code === "INVALID_LEAD_TRANSITION",
      );
      assert.deepEqual(
        store.leadView(store.findLead("coastal-flow-marine", lead.eventId)!),
        before,
      );
    }
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 2,
      executions: 2,
      scheduled_actions: 0,
      handoffs: 1,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("customer update reports a missing lead without mutation", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    assert.throws(
      () => service.update(99999),
      (error: any) => error.status === 404 && error.code === "LEAD_NOT_FOUND",
    );
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 0,
      executions: 0,
      scheduled_actions: 0,
      handoffs: 0,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("malformed inquiry rejection creates no persistent side effects", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    assert.throws(
      () => service.intake({ eventId: "bad-1", message: "hello" }),
      { name: "TypeError", message: "Inquiry sender metadata is required." },
    );
    assert.deepEqual(store.counts("coastal-flow-marine"), {
      leads: 0,
      executions: 0,
      scheduled_actions: 0,
      handoffs: 0,
      message_events: 0,
    });
  } finally {
    store.close();
  }
});

test("mock messaging failure is persisted as a failed action and message event", () => {
  const store = open();
  try {
    const service = new AutomationService(store);
    const intake = service.intake(fixture("mock-boundary-failure"));
    store.db.prepare(
      "UPDATE scheduled_actions SET due_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(intake.followup.id);
    const run = service.runFollowups();
    assert.equal(run.claimed, 1);
    assert.equal(run.results[0].state, "FAILED");
    assert.equal(run.results[0].messageStatus, "FAILED");
    assert.match(run.results[0].error, /injected mock boundary failure/);
    assert.equal(
      store.db.prepare("SELECT state FROM scheduled_actions WHERE id=?").get(
        intake.followup.id,
      )?.state,
      "FAILED",
    );
    assert.equal(store.counts("coastal-flow-marine").message_events, 1);
  } finally {
    store.close();
  }
});

test("new-demo rejects invalid and existing slugs, and creates a valid prospect skeleton", () => {
  const cwd = mkdtempSync(join(tmpdir(), "coastal-new-demo-"));
  const script = resolve("scripts/new-demo.ts");
  try {
    const invalid = spawnSync(process.execPath, [script, "Bad--Slug"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Slug must use lowercase/);
    const created = spawnSync(process.execPath, [script, "sample-marina"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /Created prospects\/sample-marina/);
    const config = JSON.parse(
      readFileSync(join(cwd, "prospects/sample-marina/prospect.json"), "utf8"),
    );
    assert.equal(config.slug, "sample-marina");
    assert.equal(config.displayName, "Sample Marina");
    assert.deepEqual(config.demoScenarios, [{
      id: "synthetic-example",
      label: "Synthetic example",
      fixture: "synthetic-example.json",
    }]);
    const fixture = JSON.parse(
      readFileSync(
        join(cwd, "prospects/sample-marina/fixtures/synthetic-example.json"),
        "utf8",
      ),
    );
    assert.match(fixture.message, /clearly synthetic/);
    assert.match(
      readFileSync(
        join(cwd, "prospects/sample-marina/knowledge/README.md"),
        "utf8",
      ),
      /Human-maintained knowledge/,
    );
    const existing = spawnSync(process.execPath, [script, "sample-marina"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(existing.status, 1);
    assert.match(existing.stderr, /already exists or cannot be created/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("store operations isolate records by active prospect", () => {
  const store = open();
  try {
    const input = fixture("incomplete");
    const result: any = {
      state: "NEEDS_INFORMATION",
      needsInformation: true,
      humanRequired: false,
    };
    const first = store.createLead(
      "prospect-one",
      input,
      "hash-one",
      result,
      "2000-01-01T00:00:00.000Z",
    );
    const second = store.createLead(
      "prospect-two",
      { ...input, eventId: "other" },
      "hash-two",
      result,
      "2000-01-01T00:00:00.000Z",
    );
    assert.deepEqual(store.recent("prospect-one").map((x) => x.leadId), [
      first,
    ]);
    assert.deepEqual(store.claimDue("prospect-one").length, 1);
    assert.throws(
      () => store.markInformationReceived(second, "prospect-one"),
      /Lead not found/,
    );
    store.reset("prospect-one");
    assert.equal(store.counts("prospect-one").leads, 0);
    assert.equal(store.counts("prospect-two").leads, 1);
    assert.equal(store.recent("prospect-two")[0].leadId, second);
  } finally {
    store.close();
  }
});

test("an expired claimed follow-up lease is recovered and executed after reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "coastal-lease-"));
  const path = join(dir, "demo.sqlite");
  try {
    const firstStore = new Store(path);
    const intake = new AutomationService(firstStore).intake(
      fixture("incomplete"),
    );
    firstStore.db.prepare(
      "UPDATE scheduled_actions SET state='CLAIMED',due_at='2000-01-01T00:00:00.000Z',claimed_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(intake.followup.id);
    firstStore.close();
    const reopened = new Store(path);
    try {
      const run = new AutomationService(reopened).runFollowups();
      assert.equal(run.claimed, 1);
      assert.equal(run.results[0].state, "EXECUTED");
      assert.equal(reopened.counts("coastal-flow-marine").message_events, 1);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
