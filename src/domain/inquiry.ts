import { createHash } from "node:crypto";

export type Inquiry = {
  eventId: string;
  subject?: string;
  message: string;
  sender: {
    name?: string;
    organization?: string;
    email?: string;
    phone?: string;
  };
  location?: string;
  preferredContact?: string;
};
export type ProspectConfig = {
  slug: string;
  version: string;
  displayName: string;
  disclaimer: string;
  demoScenarios: { id: string; label: string; fixture: string }[];
  PUBLICLY_VERIFIED: {
    serviceTaxonomy: Record<
      string,
      { label: string; provenance: "PUBLICLY_VERIFIED" | "EXAMPLE_SIMULATED" }
    >;
    [key: string]: unknown;
  };
  EXAMPLE_SIMULATED: {
    serviceKeywords: Record<string, string[]>;
    urgentTerms: string[];
    requiredFields: string[];
    usefulFields: string[];
    followupDelaySeconds: number;
    timingLabel: string;
  };
  PROSPECT_CONFIRMATION_REQUIRED: string[];
};
export type Interpretation = {
  extracted: Record<string, string>;
  classification: {
    serviceGroup: string;
    serviceLabel: string;
    categoryProvenance: "PUBLICLY_VERIFIED" | "EXAMPLE_SIMULATED";
    ruleProvenance: "EXAMPLE_SIMULATED";
    matchedTerms: string[];
    urgentTerms: string[];
  };
  missing: { required: string[]; useful: string[] };
};
export interface InquiryInterpreter {
  interpret(input: Inquiry, config: ProspectConfig): Interpretation;
}
export function canReceiveCustomerInformation(
  state: string,
  followup: { action_type?: string; state?: string } | null | undefined,
) {
  return state === "NEEDS_INFORMATION" &&
    followup?.action_type === "REQUEST_INFORMATION" &&
    (followup.state === "PENDING" || followup.state === "CLAIMED");
}
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function validateInquiry(value: unknown): asserts value is Inquiry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Inquiry must be an object.");
  }
  const input = value as Partial<Inquiry>;
  if (!clean(input.eventId)) {
    throw new TypeError("Inquiry eventId is required.");
  }
  if (!clean(input.message)) {
    throw new TypeError("Inquiry message is required.");
  }
  if (
    !input.sender || typeof input.sender !== "object" ||
    Array.isArray(input.sender)
  ) throw new TypeError("Inquiry sender metadata is required.");
}
export function normalizeInquiry(input: Inquiry): Inquiry {
  return {
    eventId: clean(input.eventId),
    subject: clean(input.subject),
    message: clean(input.message),
    sender: {
      name: clean(input.sender.name),
      organization: clean(input.sender.organization),
      email: clean(input.sender.email).toLowerCase(),
      phone: clean(input.sender.phone),
    },
    location: clean(input.location),
    preferredContact: clean(input.preferredContact).toLowerCase(),
  };
}
export function payloadHash(input: Inquiry) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export function makeResult(
  input: Inquiry,
  config: ProspectConfig,
  interpretation: Interpretation,
) {
  const humanRequired = interpretation.classification.urgentTerms.length > 0;
  const needsInformation = interpretation.missing.required.length > 0 ||
    interpretation.missing.useful.length > 0;
  const state = humanRequired
    ? "HUMAN_REQUIRED"
    : needsInformation
    ? "NEEDS_INFORMATION"
    : "INTAKE_READY";
  const trace = [
    ["VALIDATE_INPUT", "Validated required envelope"],
    ["NORMALIZE", "Normalized strings and email"],
    ["INTERPRET", `Classified ${interpretation.classification.serviceGroup}`],
    [
      "MISSING_FIELDS",
      needsInformation
        ? `Missing ${
          [...interpretation.missing.required, ...interpretation.missing.useful]
            .join(", ")
        }`
        : "None",
    ],
    ["ROUTE", state],
  ].map(([step, detail], i) => ({ order: i + 1, step, detail }));
  return {
    prospectSlug: config.slug,
    eventId: input.eventId,
    original: input,
    extracted: interpretation.extracted,
    classification: interpretation.classification,
    missing: interpretation.missing,
    state,
    needsInformation,
    humanRequired,
    nextAction: humanRequired
      ? "Qualified human reviews the emergency inquiry."
      : needsInformation
      ? "Schedule a simulated request for missing information."
      : "Intake is ready for human review.",
    timingLabel: needsInformation && !humanRequired
      ? config.EXAMPLE_SIMULATED.timingLabel
      : null,
    trace,
  };
}
