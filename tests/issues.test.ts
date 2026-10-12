import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function template(filename: string) {
  return parse(readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${filename}`, import.meta.url), "utf8"));
}

describe("GitHub issue forms", () => {
  it.each([["bug_report.yml", "Bug Report", "bug"], ["feature_request.yml", "Feature Request", "enhancement"]])(
    "%s provides a valid named form, label, and unique field IDs",
    (filename, name, label) => {
      const form = template(filename);
      expect(form.name).toBe(name);
      expect(form.description).toBeTruthy();
      expect(form.title).toBeTruthy();
      expect(form.labels).toContain(label);
      const fields = form.body.filter((field: { type: string }) => field.type !== "markdown");
      const ids = fields.map((field: { id: string }) => field.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(fields.every((field: { attributes: { label?: string } }) => field.attributes.label)).toBe(true);
      const checks = fields.find((field: { id: string }) => field.id === "checks");
      expect(checks.attributes.options.every((option: { required: boolean }) => option.required)).toBe(true);
      expect(checks.attributes.options.some((option: { label: string }) => /sensitive information/.test(option.label))).toBe(true);
    },
  );

  it("requires actionable bug details", () => {
    const fields = template("bug_report.yml").body;
    for (const id of ["app-version", "linux-distribution", "interface", "reproduce", "expected", "actual"]) {
      expect(fields.find((field: { id?: string }) => field.id === id)?.validations.required).toBe(true);
    }
  });

  it("requires feature use case and proposed solution", () => {
    const fields = template("feature_request.yml").body;
    for (const id of ["problem", "solution"]) {
      expect(fields.find((field: { id?: string }) => field.id === id)?.validations.required).toBe(true);
    }
  });

  it("disables blank issues", () => {
    expect(template("config.yml").blank_issues_enabled).toBe(false);
  });
});