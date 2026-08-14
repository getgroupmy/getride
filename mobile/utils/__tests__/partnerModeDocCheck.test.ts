import { summarizeDocIssues } from "@/utils/partnerModeDocCheck";
import type { DocCheckIssue } from "@/utils/partnerModeDocCheck";

function issue(overrides: Partial<DocCheckIssue> = {}): DocCheckIssue {
  return {
    id: "doc-1",
    name: "Driving License",
    compulsory: true,
    reason: "missing",
    ...overrides,
  };
}

describe("summarizeDocIssues", () => {
  it("returns an empty string when there are no issues", () => {
    expect(summarizeDocIssues([])).toBe("");
  });

  it("maps each reason to its human-readable phrase", () => {
    expect(summarizeDocIssues([issue({ reason: "missing" })])).toBe(
      "• Driving License (not uploaded)"
    );
    expect(summarizeDocIssues([issue({ reason: "rejected" })])).toBe(
      "• Driving License (rejected)"
    );
    expect(summarizeDocIssues([issue({ reason: "expired" })])).toBe(
      "• Driving License (expired)"
    );
  });

  it("lists up to four issues as bullet lines", () => {
    const issues = [
      issue({ name: "A" }),
      issue({ name: "B", reason: "expired" }),
      issue({ name: "C", reason: "rejected" }),
      issue({ name: "D" }),
    ];
    expect(summarizeDocIssues(issues)).toBe(
      "• A (not uploaded)\n• B (expired)\n• C (rejected)\n• D (not uploaded)"
    );
  });

  it("collapses anything past the fourth issue into a '+N more' line", () => {
    const issues = ["A", "B", "C", "D", "E", "F"].map((name) => issue({ name }));
    const summary = summarizeDocIssues(issues);
    expect(summary.split("\n")).toHaveLength(5);
    expect(summary).toContain("• +2 more");
    expect(summary).not.toContain("E (");
  });
});
