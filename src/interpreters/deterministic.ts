import type {
  Inquiry,
  InquiryInterpreter,
  ProspectConfig,
} from "../domain/inquiry.ts";
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
export class DeterministicInquiryInterpreter implements InquiryInterpreter {
  interpret(input: Inquiry, config: ProspectConfig) {
    const text = `${clean(input.subject)} ${clean(input.message)}`
      .toLowerCase();
    const matched = Object.entries(config.EXAMPLE_SIMULATED.serviceKeywords)
      .map(([group, terms]) => ({
        group,
        terms: terms.filter((term) => text.includes(term.toLowerCase())),
      })).filter((x) => x.terms.length).sort((a, b) =>
        b.terms.length - a.terms.length || a.group.localeCompare(b.group)
      );
    const extracted = {
      contactName: clean(input.sender.name),
      organization: clean(input.sender.organization),
      email: clean(input.sender.email),
      phone: clean(input.sender.phone),
      location: clean(input.location),
      preferredContact: clean(input.preferredContact),
      requestSummary: clean(input.subject) || clean(input.message),
      photos: /photos?\s+(?:are\s+)?(?:available|attached|included)/i.test(
          input.message,
        )
        ? "Available"
        : "",
      siteAccess: /site access[^.;]*/i.exec(input.message)?.[0] ?? "",
    };
    const serviceGroup = matched[0]?.group ?? "unclassified";
    const category = config.PUBLICLY_VERIFIED.serviceTaxonomy[serviceGroup] ??
      { label: "Unclassified", provenance: "EXAMPLE_SIMULATED" as const };
    return {
      extracted,
      classification: {
        serviceGroup,
        serviceLabel: category.label,
        categoryProvenance: category.provenance,
        ruleProvenance: "EXAMPLE_SIMULATED" as const,
        matchedTerms: matched.flatMap((x) => x.terms),
        urgentTerms: config.EXAMPLE_SIMULATED.urgentTerms.filter((term) =>
          text.includes(term.toLowerCase())
        ),
      },
      missing: {
        required: config.EXAMPLE_SIMULATED.requiredFields.filter((k) =>
          !extracted[k as keyof typeof extracted]
        ),
        useful: config.EXAMPLE_SIMULATED.usefulFields.filter((k) =>
          !extracted[k as keyof typeof extracted]
        ),
      },
    };
  }
}
