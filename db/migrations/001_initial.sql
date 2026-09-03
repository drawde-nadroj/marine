PRAGMA foreign_keys = ON;
CREATE TABLE leads (
 id INTEGER PRIMARY KEY, prospect_slug TEXT NOT NULL, external_event_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 input_json TEXT NOT NULL, result_json TEXT NOT NULL, state TEXT NOT NULL, needs_information INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(prospect_slug, external_event_id)
);
CREATE TABLE executions (
 id INTEGER PRIMARY KEY, lead_id INTEGER, kind TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE TABLE scheduled_actions (
 id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, logical_key TEXT NOT NULL UNIQUE, action_type TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('PENDING','CLAIMED','EXECUTED','FAILED','CANCELED')), due_at TEXT NOT NULL,
 claimed_at TEXT, finished_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE TABLE handoffs (
 id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL UNIQUE, reason TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE TABLE message_events (
 id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, scheduled_action_id INTEGER, status TEXT NOT NULL CHECK(status IN ('SIMULATED','FAILED')),
 recipient TEXT NOT NULL, body TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE,
 FOREIGN KEY(scheduled_action_id) REFERENCES scheduled_actions(id) ON DELETE SET NULL
);
