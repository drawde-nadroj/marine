import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = process.argv.at(-1) ?? "";
const slug = arg.startsWith("--slug=") ? arg.slice(7) : arg;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("Slug must use lowercase letters, digits, and single hyphens.");
  process.exit(1);
}
const root = join("prospects", slug);
try {
  mkdirSync("prospects", { recursive: true });
  mkdirSync(root);
  mkdirSync(join(root, "knowledge"));
  mkdirSync(join(root, "fixtures"));
} catch {
  console.error(`Prospect already exists or cannot be created: ${slug}`);
  process.exit(1);
}
const fixture = {
  eventId: "synthetic-example-001",
  subject: "Synthetic demo inquiry",
  message: "This is clearly synthetic demo data.",
  sender: { name: "Demo Person", email: "demo@example.invalid" },
};
const config = {
  slug,
  version: "demo-1.0.0",
  displayName: slug.split("-").map((x) => x[0].toUpperCase() + x.slice(1)).join(
    " ",
  ),
  disclaimer:
    "Unofficial local demonstration using synthetic operational data.",
  demoScenarios: [{
    id: "synthetic-example",
    label: "Synthetic example",
    fixture: "synthetic-example.json",
  }],
  PUBLICLY_VERIFIED: {
    sources: [],
    serviceTaxonomy: {
      unclassified: { label: "Unclassified", provenance: "EXAMPLE_SIMULATED" },
    },
  },
  EXAMPLE_SIMULATED: {
    serviceKeywords: { unclassified: [] },
    urgentTerms: [],
    requiredFields: ["contactName", "email", "requestSummary"],
    usefulFields: [],
    followupDelaySeconds: 15,
    timingLabel: "ACCELERATED DEMO TIMING — example policy, 15 seconds",
  },
  PROSPECT_CONFIRMATION_REQUIRED: [
    "operational policy",
    "system integrations",
    "handoff owner",
  ],
};
writeFileSync(
  join(root, "prospect.json"),
  JSON.stringify(config, null, 2) + "\n",
);
writeFileSync(
  join(root, "fixtures", "synthetic-example.json"),
  JSON.stringify(fixture, null, 2) + "\n",
);
writeFileSync(
  join(root, "knowledge", "README.md"),
  "# Human-maintained knowledge\n\nThis directory is read-only context, not transactional state.\n",
);
console.log(`Created ${root}`);
