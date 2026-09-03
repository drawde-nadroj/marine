import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  canReceiveCustomerInformation,
  type Inquiry,
} from "../domain/inquiry.ts";

type LeadRow = {
  id: number;
  input_json: string;
  result_json: string;
  payload_hash: string;
  state: string;
  needs_information: number;
};
export class Store {
  db: DatabaseSync;
  constructor(path = "data/demo.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    this.migrate();
  }
  migrate() {
    const version = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version < 1) {
      this.db.exec(
        readFileSync(
          new URL("../../db/migrations/001_initial.sql", import.meta.url),
          "utf8",
        ),
      );
      this.db.exec("PRAGMA user_version=1");
    }
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  findLead(slug: string, eventId: string) {
    return this.db.prepare(
      "SELECT * FROM leads WHERE prospect_slug=? AND external_event_id=?",
    ).get(slug, eventId) as LeadRow | undefined;
  }
  createLead(
    slug: string,
    input: Inquiry,
    hash: string,
    result: Record<string, unknown>,
    dueAt: string | null,
  ) {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const inserted = this.db.prepare(
        "INSERT INTO leads(prospect_slug,external_event_id,payload_hash,input_json,result_json,state,needs_information,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        slug,
        input.eventId,
        hash,
        JSON.stringify(input),
        JSON.stringify(result),
        String(result.state),
        result.needsInformation ? 1 : 0,
        now,
        now,
      );
      const leadId = Number(inserted.lastInsertRowid);
      this.db.prepare(
        "INSERT INTO executions(lead_id,kind,status,detail,created_at) VALUES(?,?,?,?,?)",
      ).run(
        leadId,
        "INTAKE",
        "SUCCEEDED",
        "Persisted deterministic intake",
        now,
      );
      if (result.humanRequired) {
        this.db.prepare(
          "INSERT INTO handoffs(lead_id,reason,status,created_at) VALUES(?,?,?,?)",
        ).run(leadId, "Configured urgent term matched", "OPEN", now);
      }
      if (dueAt) {
        this.db.prepare(
          "INSERT INTO scheduled_actions(lead_id,logical_key,action_type,state,due_at) VALUES(?,?,?,?,?)",
        ).run(
          leadId,
          `lead:${leadId}:missing-info-v1`,
          "REQUEST_INFORMATION",
          "PENDING",
          dueAt,
        );
      }
      return leadId;
    });
  }
  leadView(row: LeadRow, duplicate = false) {
    const result = JSON.parse(row.result_json);
    const followup = this.db.prepare(
      "SELECT id,logical_key,action_type,state,due_at,attempts,last_error FROM scheduled_actions WHERE lead_id=?",
    ).get(row.id) as { action_type?: string; state?: string } | undefined;
    return {
      ...result,
      leadId: row.id,
      duplicate,
      followup: followup ?? null,
      canReceiveCustomerInformation: canReceiveCustomerInformation(
        row.state,
        followup,
      ),
      executionHistory: this.db.prepare(
        "SELECT kind,status,detail,created_at FROM executions WHERE lead_id=? ORDER BY id",
      ).all(row.id),
    };
  }
  recent(slug: string, limit = 25) {
    return (this.db.prepare(
      "SELECT * FROM leads WHERE prospect_slug=? ORDER BY id DESC LIMIT ?",
    ).all(slug, limit) as LeadRow[]).map((row) => this.leadView(row));
  }
  markInformationReceived(leadId: number, slug: string) {
    return this.transaction(() => {
      const row = this.db.prepare(
        "SELECT * FROM leads WHERE id=? AND prospect_slug=?",
      ).get(leadId, slug) as LeadRow | undefined;
      if (!row) {
        throw Object.assign(new Error("Lead not found."), {
          status: 404,
          code: "LEAD_NOT_FOUND",
        });
      }
      const followup = this.db.prepare(
        "SELECT action_type,state FROM scheduled_actions WHERE lead_id=?",
      ).get(leadId) as { action_type?: string; state?: string } | undefined;
      if (!canReceiveCustomerInformation(row.state, followup)) {
        throw Object.assign(
          new Error(
            "Customer information update requires a NEEDS_INFORMATION lead with an active safe follow-up.",
          ),
          { status: 409, code: "INVALID_LEAD_TRANSITION" },
        );
      }
      const result = JSON.parse(row.result_json);
      result.needsInformation = false;
      result.state = "INTAKE_READY";
      result.nextAction =
        "Customer information received; obsolete follow-up canceled.";
      const now = new Date().toISOString();
      this.db.prepare(
        "UPDATE leads SET state=?,needs_information=0,result_json=?,updated_at=? WHERE id=?",
      ).run("INTAKE_READY", JSON.stringify(result), now, leadId);
      const canceled = this.db.prepare(
        "UPDATE scheduled_actions SET state='CANCELED',finished_at=? WHERE lead_id=? AND state IN ('PENDING','CLAIMED')",
      ).run(now, leadId);
      this.db.prepare(
        "INSERT INTO executions(lead_id,kind,status,detail,created_at) VALUES(?,?,?,?,?)",
      ).run(
        leadId,
        "CUSTOMER_UPDATE",
        "SUCCEEDED",
        `Canceled ${canceled.changes} action(s)`,
        now,
      );
      return this.leadView(
        this.db.prepare("SELECT * FROM leads WHERE id=?").get(
          leadId,
        ) as LeadRow,
      );
    });
  }
  claimDue(slug: string, now = new Date().toISOString(), limit = 20) {
    return this.transaction(() => {
      const leaseCutoff = new Date(new Date(now).getTime() - 5 * 60 * 1000)
        .toISOString();
      this.db.prepare(
        "UPDATE scheduled_actions SET state='PENDING',claimed_at=NULL,last_error='Recovered expired claim lease' WHERE state='CLAIMED' AND claimed_at<=? AND lead_id IN (SELECT id FROM leads WHERE prospect_slug=?)",
      ).run(leaseCutoff, slug);
      const rows = this.db.prepare(
        "SELECT sa.id FROM scheduled_actions sa JOIN leads l ON l.id=sa.lead_id WHERE sa.state='PENDING' AND sa.due_at<=? AND l.needs_information=1 AND l.prospect_slug=? ORDER BY sa.due_at,sa.id LIMIT ?",
      ).all(now, slug, limit) as { id: number }[];
      const claimedAt = new Date().toISOString();
      for (const row of rows) {
        this.db.prepare(
          "UPDATE scheduled_actions SET state='CLAIMED',claimed_at=?,attempts=attempts+1 WHERE id=? AND state='PENDING'",
        ).run(claimedAt, row.id);
      }
      return rows.map((row) => row.id);
    });
  }
  actionForExecution(id: number) {
    return this.transaction(() =>
      this.db.prepare(
        "SELECT sa.*,l.input_json,l.needs_information,l.state AS lead_state FROM scheduled_actions sa JOIN leads l ON l.id=sa.lead_id WHERE sa.id=? AND sa.state='CLAIMED' AND l.needs_information=1",
      ).get(id) as any
    );
  }
  finishAction(
    action: any,
    status: "SIMULATED" | "FAILED",
    body: string,
    error?: string,
  ) {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const state = status === "SIMULATED" ? "EXECUTED" : "FAILED";
      const finished = this.db.prepare(
        "UPDATE scheduled_actions SET state=?,finished_at=?,last_error=? WHERE id=? AND state='CLAIMED'",
      ).run(state, now, error ?? null, action.id);
      if (finished.changes !== 1) {
        return {
          actionId: action.id,
          leadId: action.lead_id,
          state: "CANCELED_OR_INVALID",
        };
      }
      this.db.prepare(
        "INSERT INTO message_events(lead_id,scheduled_action_id,status,recipient,body,error,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        action.lead_id,
        action.id,
        status,
        JSON.parse(action.input_json).sender.email || "unknown",
        body,
        error ?? null,
        now,
      );
      this.db.prepare(
        "INSERT INTO executions(lead_id,kind,status,detail,created_at) VALUES(?,?,?,?,?)",
      ).run(action.lead_id, "FOLLOWUP", state, error ?? status, now);
      return {
        actionId: action.id,
        leadId: action.lead_id,
        state,
        messageStatus: status,
        error,
      };
    });
  }
  counts(slug: string) {
    return Object.fromEntries(
      ["leads", "executions", "scheduled_actions", "handoffs", "message_events"]
        .map((t) => {
          const query = t === "leads"
            ? "SELECT count(*) count FROM leads WHERE prospect_slug=?"
            : `SELECT count(*) count FROM ${t} WHERE lead_id IN (SELECT id FROM leads WHERE prospect_slug=?)`;
          return [
            t,
            (this.db.prepare(query).get(slug) as { count: number }).count,
          ];
        }),
    );
  }
  reset(slug: string) {
    this.transaction(() => {
      for (
        const t of [
          "message_events",
          "handoffs",
          "scheduled_actions",
          "executions",
        ]
      ) {
        this.db.prepare(
          `DELETE FROM ${t} WHERE lead_id IN (SELECT id FROM leads WHERE prospect_slug=?)`,
        ).run(slug);
      }
      this.db.prepare("DELETE FROM leads WHERE prospect_slug=?").run(slug);
    });
  }
}
