import { readFile } from "node:fs/promises";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import { ProjectConfigError } from "../config/errors.js";
import { loadStrictYamlDocument } from "../config/load.js";
import { type CapabilityBriefIssue, CapabilityBriefError } from "./errors.js";
import type { ScenarioCase, SkillPressCapabilityBrief } from "./generated.js";

export type ResolvedCapabilityBrief = SkillPressCapabilityBrief & { readonly version: string };

const schemaUrl = new URL("../../schemas/capability-brief.schema.json", import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile<SkillPressCapabilityBrief>(
  schema,
) as ValidateFunction<SkillPressCapabilityBrief>;

function issue(code: string, path: string, message: string): CapabilityBriefIssue {
  return { code, path, message };
}

function schemaIssues(errors: readonly ErrorObject[]): CapabilityBriefIssue[] {
  return errors.map((error) =>
    issue(
      `brief.schema.${error.keyword}`,
      error.instancePath === "" ? "/" : error.instancePath,
      error.message ?? "does not match the capability brief schema",
    ),
  );
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isPlaceholderLine(trimmed: string): boolean {
  return (
    /^(?:todo|tbd|fixme|changeme|placeholder|replace me|fill me)$/iu.test(trimmed) ||
    /^(?:todo|tbd|fixme|changeme|placeholder|replace me|fill me)\s*[:—-].*$/iu.test(trimmed) ||
    /^(?:TODO|TBD|FIXME|CHANGEME)\s+.+$/u.test(trimmed) ||
    /^\[(?:todo|tbd|fixme|changeme|placeholder|fill|replace|insert|describe|enter|your)\b[^\]]*\](?:\s.*)?$/iu.test(
      trimmed,
    )
  );
}

function isPlaceholder(value: string): boolean {
  if (value.trim() === "") {
    return true;
  }
  return value
    .split(/\r\n?|\n/u)
    .some((line) => line.trim() !== "" && isPlaceholderLine(line.trim()));
}

const NON_PROSE_EXACT_PATHS = new Set([
  "/name",
  "/version",
  "/repository",
  "/author/github",
  "/license/id",
  "/risk",
  "/execution/sandbox",
  "/execution/network",
]);

function isNonProsePath(path: string): boolean {
  return (
    NON_PROSE_EXACT_PATHS.has(path) ||
    (path.startsWith("/capability/inputs/") && path.endsWith("/name")) ||
    (path.startsWith("/capability/outputs/") && path.endsWith("/name")) ||
    (path.startsWith("/tests/commands/") && (path.includes("/argv/") || path.endsWith("/cwd"))) ||
    path.startsWith("/publish/targets/") ||
    (path.startsWith("/scenarios/") && path.endsWith("/id"))
  );
}

function placeholderIssues(value: unknown, path = ""): CapabilityBriefIssue[] {
  if (typeof value === "string") {
    return !isNonProsePath(path) && isPlaceholder(value)
      ? [issue("brief.placeholder", path === "" ? "/" : path, "value is a placeholder")]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => placeholderIssues(entry, `${path}/${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      placeholderIssues(entry, `${path}/${escapePointer(key)}`),
    );
  }
  return [];
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function invalidUnicodeIssues(value: unknown, path = ""): CapabilityBriefIssue[] {
  if (typeof value === "string") {
    return hasUnpairedSurrogate(value)
      ? [
          issue(
            "brief.invalid_unicode",
            path === "" ? "/" : path,
            "string contains an unpaired UTF-16 surrogate",
          ),
        ]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => invalidUnicodeIssues(entry, `${path}/${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      invalidUnicodeIssues(entry, `${path}/${escapePointer(key)}`),
    );
  }
  return [];
}

function normalizeComparableText(value: string): string {
  // This catches lexical disguises only; semantic overlap belongs to later behavioral gates.
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

interface ScenarioGroup {
  readonly path: string;
  readonly scenarios: readonly ScenarioCase[];
  readonly requiresForbiddenBehavior: boolean;
}

function scenarioGroups(brief: SkillPressCapabilityBrief): readonly ScenarioGroup[] {
  return [
    {
      path: "/scenarios/training/positive",
      scenarios: brief.scenarios.training.positive,
      requiresForbiddenBehavior: false,
    },
    {
      path: "/scenarios/training/nearMiss",
      scenarios: brief.scenarios.training.nearMiss,
      requiresForbiddenBehavior: true,
    },
    {
      path: "/scenarios/training/failure",
      scenarios: brief.scenarios.training.failure,
      requiresForbiddenBehavior: false,
    },
    {
      path: "/scenarios/training/adversarial",
      scenarios: brief.scenarios.training.adversarial,
      requiresForbiddenBehavior: true,
    },
    {
      path: "/scenarios/holdout/positive",
      scenarios: brief.scenarios.holdout.positive,
      requiresForbiddenBehavior: false,
    },
    {
      path: "/scenarios/holdout/nearMiss",
      scenarios: brief.scenarios.holdout.nearMiss,
      requiresForbiddenBehavior: true,
    },
  ];
}

function uniquenessIssues(brief: SkillPressCapabilityBrief): CapabilityBriefIssue[] {
  const issues: CapabilityBriefIssue[] = [];
  const ids = new Map<string, string>();
  const prompts = new Map<string, string>();
  const activationConditions = new Map(
    brief.capability.useWhen.map(
      (value, index) => [normalizeComparableText(value), `/capability/useWhen/${index}`] as const,
    ),
  );

  brief.capability.doNotUseWhen.forEach((value, index) => {
    const activePath = activationConditions.get(normalizeComparableText(value));
    if (activePath !== undefined) {
      issues.push(
        issue(
          "brief.activation_contradiction",
          `/capability/doNotUseWhen/${index}`,
          `condition also appears at ${activePath}`,
        ),
      );
    }
  });

  for (const group of scenarioGroups(brief)) {
    group.scenarios.forEach((scenario, index) => {
      const path = `${group.path}/${index}`;
      const previousId = ids.get(scenario.id);
      if (previousId !== undefined) {
        issues.push(
          issue(
            "brief.scenario_id_duplicate",
            `${path}/id`,
            `scenario id also appears at ${previousId}`,
          ),
        );
      } else {
        ids.set(scenario.id, `${path}/id`);
      }

      const promptKey = normalizeComparableText(scenario.prompt);
      const previousPrompt = prompts.get(promptKey);
      if (previousPrompt !== undefined) {
        issues.push(
          issue(
            "brief.scenario_prompt_duplicate",
            `${path}/prompt`,
            `scenario prompt also appears at ${previousPrompt}`,
          ),
        );
      } else {
        prompts.set(promptKey, `${path}/prompt`);
      }

      if (group.requiresForbiddenBehavior && scenario.forbiddenBehavior === undefined) {
        issues.push(
          issue(
            "brief.forbidden_behavior_required",
            `${path}/forbiddenBehavior`,
            "near-miss and adversarial scenarios require forbidden behavior",
          ),
        );
      }

      if (scenario.forbiddenBehavior !== undefined) {
        const expected = new Set(scenario.expectedBehavior.map(normalizeComparableText));
        scenario.forbiddenBehavior.forEach((behavior, behaviorIndex) => {
          if (expected.has(normalizeComparableText(behavior))) {
            issues.push(
              issue(
                "brief.behavior_contradiction",
                `${path}/forbiddenBehavior/${behaviorIndex}`,
                "behavior is both expected and forbidden in the same scenario",
              ),
            );
          }
        });
      }
    });
  }

  for (const [path, names] of [
    ["/capability/inputs", brief.capability.inputs.map((entry) => entry.name)],
    ["/capability/outputs", brief.capability.outputs.map((entry) => entry.name)],
  ] as const) {
    const seen = new Set<string>();
    names.forEach((name, index) => {
      if (seen.has(name)) {
        issues.push(issue("brief.name_duplicate", `${path}/${index}/name`, "name must be unique"));
      }
      seen.add(name);
    });
  }

  return issues;
}

function remapSourceError(error: ProjectConfigError): CapabilityBriefError {
  return new CapabilityBriefError(
    "Unable to load the SkillPress capability brief.",
    error.issues.map((entry) =>
      issue(
        entry.code.replace(/^config\./u, "brief.source."),
        entry.path,
        entry.message.replaceAll("configuration", "capability brief"),
      ),
    ),
    error,
  );
}

export async function loadCapabilityBrief(path: string): Promise<ResolvedCapabilityBrief> {
  let value: unknown;
  try {
    value = await loadStrictYamlDocument(path);
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      throw remapSourceError(error);
    }
    throw error;
  }

  if (!validate(value)) {
    throw new CapabilityBriefError(
      "Capability brief does not match schema version 1.",
      schemaIssues(validate.errors as ErrorObject[]),
    );
  }

  const semanticIssues = [
    ...invalidUnicodeIssues(value),
    ...placeholderIssues(value),
    ...uniquenessIssues(value),
  ];
  if (semanticIssues.length > 0) {
    throw new CapabilityBriefError("Capability brief is incomplete or ambiguous.", semanticIssues);
  }

  return { ...value, version: value.version ?? "0.1.0" };
}
