import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProspectConfig } from "./domain/inquiry.ts";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function activeProspectSlug(): string {
  const slug = process.env.PROSPECT_SLUG || "coastal-flow-marine";
  if (!SAFE_ID.test(slug)) throw new Error("Invalid PROSPECT_SLUG.");
  return slug;
}

export function loadProspect(slug = activeProspectSlug()): ProspectConfig {
  if (!SAFE_ID.test(slug)) throw new Error("Invalid prospect slug.");
  const config = JSON.parse(
    readFileSync(
      new URL(`../prospects/${slug}/prospect.json`, import.meta.url),
      "utf8",
    ),
  ) as ProspectConfig;
  if (config.slug !== slug || !Array.isArray(config.demoScenarios)) {
    throw new Error(`Invalid prospect configuration for ${slug}.`);
  }
  for (const scenario of config.demoScenarios) {
    if (
      !SAFE_ID.test(scenario.id) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(scenario.fixture)
    ) {
      throw new Error(`Invalid demo scenario configuration for ${slug}.`);
    }
  }
  for (
    const category of Object.values(
      config.PUBLICLY_VERIFIED.serviceTaxonomy ?? {},
    )
  ) {
    if (
      !category.label ||
      !["PUBLICLY_VERIFIED", "EXAMPLE_SIMULATED"].includes(category.provenance)
    ) {
      throw new Error(`Invalid service taxonomy configuration for ${slug}.`);
    }
  }
  return config;
}

export function loadDemoScenario(id: string): unknown {
  if (!SAFE_ID.test(id)) throw new Error("Invalid scenario id.");
  const config = loadProspect();
  const scenario = config.demoScenarios.find((item) => item.id === id);
  if (!scenario) {
    throw Object.assign(new Error("Scenario not found."), { status: 404 });
  }
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "prospects",
        config.slug,
        "fixtures",
        scenario.fixture,
      ),
      "utf8",
    ),
  );
}
