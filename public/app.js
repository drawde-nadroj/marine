const $ = (id) => document.getElementById(id);
let lastInput = null;
let lastLead = null;

const pretty = (value) => JSON.stringify(value, null, 2);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (
      character,
    ) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]),
  );

async function api(path, requestBody) {
  const response = await fetch(path, {
    method: requestBody ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderLead(lead, { refreshRecent = true } = {}) {
  lastLead = lead;
  $("results").hidden = false;
  $("original").textContent = pretty(lead.original);
  $("state").textContent = lead.state.replaceAll("_", " ");
  $("duplicateStatus").textContent = lead.duplicate
    ? "DUPLICATE REPLAY — no new lead, action, or message"
    : "NEW — persisted once";
  $("action").textContent = lead.nextAction;
  $("ids").innerHTML = `<div><dt>Lead</dt><dd>${
    escape(lead.leadId)
  }</dd></div><div><dt>Event</dt><dd>${escape(lead.eventId)}</dd></div>`;
  $("extracted").textContent = pretty(lead.extracted);
  $("rules").textContent = pretty(lead.classification);
  $("missing").textContent = pretty(lead.missing);
  $("followup").textContent = pretty(lead.followup);
  $("history").textContent = pretty(lead.executionHistory ?? []);
  $("trace").innerHTML = lead.trace.map((item) =>
    `<li><span>${escape(item.order)}</span><div><strong>${
      escape(item.step)
    }</strong><p>${escape(item.detail)}</p></div></li>`
  ).join("");
  $("duplicate").disabled = !lastInput;
  $("received").disabled = !lead.canReceiveCustomerInformation;
  if (refreshRecent) void refreshLeads(false);
}

async function submitInquiry(input) {
  $("status").textContent = "Running through n8n…";
  try {
    const lead = await api("/api/demo/intake", input);
    lastInput = input;
    renderLead(lead);
    $("status").textContent = `Workflow returned ${lead.state}${
      lead.duplicate ? " as duplicate replay" : ""
    }.`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}

function renderRecentLeads(leads) {
  $("recent").innerHTML = leads.length
    ? `<table><thead><tr><th>Lead</th><th>Event</th><th>State</th><th>Follow-up</th></tr></thead><tbody>${
      leads.map((lead) =>
        `<tr><td>${escape(lead.leadId)}</td><td>${
          escape(lead.eventId)
        }</td><td>${escape(lead.state)}</td><td>${
          escape(lead.followup?.state || "—")
        }</td></tr>`
      ).join("")
    }</tbody></table>`
    : "<p>No persisted leads.</p>";
}

async function refreshLeads(updateCurrent = true) {
  try {
    const { leads } = await api("/api/demo/leads");
    renderRecentLeads(leads);
    const current = lastLead
      ? leads.find((lead) => lead.leadId === lastLead.leadId)
      : leads[0];
    if (updateCurrent && current) renderLead(current, { refreshRecent: false });
  } catch (error) {
    $("recent").textContent = error.message;
  }
}

async function loadScenarios() {
  try {
    const { prospect, scenarios } = await api("/api/demo/scenarios");
    $("prospectName").textContent = prospect.displayName.toUpperCase();
    $("disclaimer").textContent = prospect.disclaimer;
    $("timingLabel").textContent = prospect.followupTimingLabel;
    const container = $("scenarios");
    container.replaceChildren();
    for (const scenario of scenarios) {
      const button = document.createElement("button");
      button.textContent = scenario.label;
      button.addEventListener("click", async () => {
        const input = await api(`/api/demo/scenarios/${scenario.id}`);
        await submitInquiry(input);
      });
      container.append(button);
    }
  } catch (error) {
    $("status").textContent = `Could not load scenarios: ${error.message}`;
  }
}

$("duplicate").addEventListener("click", () => submitInquiry(lastInput));
$("run").addEventListener("click", async () => {
  try {
    const result = await api("/api/demo/followups/run", {});
    await refreshLeads(true);
    $("status").textContent = `Scheduler claimed ${result.claimed}; ${
      result.results.map((item) => item.messageStatus || item.state).join(
        ", ",
      ) || "nothing due"
    }.`;
  } catch (error) {
    $("status").textContent = error.message;
  }
});
$("received").addEventListener("click", async () => {
  try {
    const lead = await api("/api/demo/customer-update", {
      leadId: lastLead.leadId,
    });
    renderLead(lead);
    $("status").textContent =
      "Information received; obsolete safe follow-up canceled.";
  } catch (error) {
    $("status").textContent = error.message;
  }
});
$("reset").addEventListener("click", async () => {
  if (!confirm("Delete all local demo records?")) return;
  await api("/api/demo/reset", { confirm: "RESET DEMO" });
  lastLead = null;
  lastInput = null;
  $("results").hidden = true;
  $("duplicate").disabled = true;
  $("received").disabled = true;
  $("status").textContent = "Local demo reset.";
  await refreshLeads(false);
});

await Promise.all([loadScenarios(), refreshLeads(true)]);
