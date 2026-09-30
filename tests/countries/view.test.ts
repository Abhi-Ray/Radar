/** Pure /countries display helpers: rule stamp, watch meta, as-of day, spans and day counts. */
import { describe, expect, it } from "vitest";
import { ruleFreshness } from "../../src/components/countries/model";
import { changeKindLabel, daysFromToday, effectiveSpan, parseAsOf, ruleStamp, watchMeta } from "../../src/components/countries/view";

const NOW = new Date("2026-09-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("country view helpers", () => {
  it("stamps a rule by its freshness", () => {
    expect(ruleStamp(ruleFreshness({ verificationStatus: "verified", lastVerifiedAt: daysAgo(10), nextReviewAt: daysAgo(-80) }, NOW))).toEqual({
      label: "Verified",
      tone: "radar",
      dashed: false,
    });
    expect(ruleStamp(ruleFreshness({ verificationStatus: "verified", lastVerifiedAt: daysAgo(30), nextReviewAt: daysAgo(1) }, NOW)).label).toBe("Review due");
    expect(ruleStamp(ruleFreshness({ verificationStatus: "verified", lastVerifiedAt: daysAgo(91), nextReviewAt: daysAgo(1) }, NOW))).toEqual({
      label: "Stale",
      tone: "signal",
      dashed: true,
    });
    expect(ruleStamp(ruleFreshness({ verificationStatus: "unverified", lastVerifiedAt: null, nextReviewAt: null }, NOW)).label).toBe("Unverified");
    const stale = ruleFreshness({ verificationStatus: "verified", lastVerifiedAt: daysAgo(600), nextReviewAt: daysAgo(500) }, NOW);
    expect(ruleStamp(stale, "past")).toEqual({ label: "Superseded", tone: "concrete", dashed: true });
    expect(ruleStamp(ruleFreshness({ verificationStatus: "unverified", lastVerifiedAt: null, nextReviewAt: null }, NOW), "upcoming").label).toBe("Announced");
  });

  it("reads ?asof= only when it is a real day", () => {
    expect(parseAsOf("2026-01-15")).toBe("2026-01-15");
    expect(parseAsOf([" 2025-12-31 ", "2026-01-01"])).toBe("2025-12-31");
    expect(parseAsOf("2026-02-30")).toBeNull();
    expect(parseAsOf("yesterday")).toBeNull();
    expect(parseAsOf(undefined)).toBeNull();
  });

  it("describes effective spans and counts days", () => {
    expect(effectiveSpan("2026-01-01", "2026-12-31")).toBe("2026-01-01 → 2026-12-31");
    expect(effectiveSpan("2026-01-01", null)).toBe("from 2026-01-01");
    expect(effectiveSpan(null, "2026-12-31")).toBe("until 2026-12-31");
    expect(effectiveSpan(null, null)).toBe("no start date");
    expect(daysFromToday("2026-09-30", "2026-12-29")).toBe(90);
    expect(daysFromToday("2026-09-30", "2026-09-01")).toBe(-29);
    expect(daysFromToday("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("labels watches and change kinds, with fallbacks", () => {
    expect(watchMeta("changed").tone).toBe("signal");
    expect(watchMeta("mystery")).toEqual({ label: "mystery", tone: "concrete", blurb: "" });
    expect(changeKindLabel("verified")).toBe("Verified");
    expect(changeKindLabel("page_changed")).toBe("Official page changed");
    expect(changeKindLabel("threshold_moved")).toBe("threshold moved");
  });
});
