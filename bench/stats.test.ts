import { describe, it, expect } from "vitest";
import {
  wilson,
  ruleOfThree,
  exactZeroUpper,
  designEffect,
  effectiveN,
  clusterBootstrap,
  Z_975,
  type Cluster,
} from "./stats.js";

const mean = (items: readonly number[]): number =>
  items.reduce((sum, v) => sum + v, 0) / items.length;

const cluster = (id: string, items: readonly number[]): Cluster<number> => ({
  id,
  items,
});

describe("wilson", () => {
  it("0/20 has upper bound 0.1611 and lower bound 0", () => {
    const w = wilson(0, 20);
    expect(w.p).toBe(0);
    expect(w.lower).toBe(0);
    expect(w.upper).toBeCloseTo(0.1611, 4);
  });

  it("10/10 is [0.7225, 1]", () => {
    const w = wilson(10, 10);
    expect(w.p).toBe(1);
    expect(w.lower).toBeCloseTo(0.7225, 4);
    // Exactly 1, not 0.9999999999999999, so `upper === 1` checks hold.
    expect(w.upper).toBe(1);
  });

  it("110/120 is [0.8534, 0.9541]", () => {
    const w = wilson(110, 120);
    expect(w.p).toBeCloseTo(110 / 120, 12);
    expect(w.lower).toBeCloseTo(0.8534, 4);
    expect(w.upper).toBeCloseTo(0.9541, 4);
  });

  it("accepts non-integer counts so design-effect-deflated x/deff, n/deff work", () => {
    const w = wilson(110 / 2.5, 120 / 2.5);
    expect(w.p).toBeCloseTo(110 / 120, 12);
    expect(w.upper - w.lower).toBeGreaterThan(0.9541 - 0.8534);
  });

  it("rejects n <= 0 and x outside [0, n]", () => {
    expect(() => wilson(0, 0)).toThrow(RangeError);
    expect(() => wilson(-1, 10)).toThrow(RangeError);
    expect(() => wilson(11, 10)).toThrow(RangeError);
  });
});

describe("zero-event bounds", () => {
  it("ruleOfThree(20) = 0.15", () => {
    expect(ruleOfThree(20)).toBeCloseTo(0.15, 12);
  });

  it("exactZeroUpper(20) = 0.1391", () => {
    expect(exactZeroUpper(20)).toBeCloseTo(0.1391, 4);
  });

  it("reject n <= 0", () => {
    expect(() => ruleOfThree(0)).toThrow(RangeError);
    expect(() => exactZeroUpper(0)).toThrow(RangeError);
  });
});

describe("design effect", () => {
  it("designEffect(210, 1) = 210 and effectiveN(210, 210, 1) = 1", () => {
    expect(designEffect(210, 1)).toBe(210);
    expect(effectiveN(210, 210, 1)).toBe(1);
  });

  it("rho = 0 leaves n unchanged", () => {
    expect(designEffect(30, 0)).toBe(1);
    expect(effectiveN(120, 30, 0)).toBe(120);
  });

  it("accepts a non-integer mean cluster size m >= 1", () => {
    expect(designEffect(1, 0.7)).toBe(1);
    expect(designEffect(2.5, 0.2)).toBeCloseTo(1.3, 12);
  });

  it("rejects rho outside [0, 1], including negative and NaN rho", () => {
    for (const rho of [-0.01, -1, 1.01, Number.NaN]) {
      expect(() => designEffect(10, rho)).toThrow(RangeError);
      expect(() => effectiveN(100, 10, rho)).toThrow(RangeError);
    }
    expect(() => designEffect(10, -0.2)).toThrow(/rho in \[0, 1\]/);
  });

  it("rejects m < 1", () => {
    for (const m of [0, 0.5, -3, Number.NaN]) {
      expect(() => designEffect(m, 0.1)).toThrow(RangeError);
      expect(() => effectiveN(100, m, 0.1)).toThrow(RangeError);
    }
    expect(() => designEffect(0, 0.1)).toThrow(/m >= 1/);
  });

  it("rejects non-finite m (Infinity with rho 0 would give NaN)", () => {
    for (const rho of [0, 0.1]) {
      expect(() => designEffect(Number.POSITIVE_INFINITY, rho)).toThrow(
        /finite m/,
      );
      expect(() => effectiveN(100, Number.POSITIVE_INFINITY, rho)).toThrow(
        RangeError,
      );
    }
  });
});

describe("default z", () => {
  it("is the double nearest the 0.975 normal quantile", () => {
    // ECMAScript rounds a decimal of at most 20 significant digits correctly.
    expect(Z_975).toBe(Number("1.9599639845400542355"));
    expect(Z_975).not.toBe(1.959963984540054);
    expect(wilson(110, 120)).toEqual(wilson(110, 120, Z_975));
    expect(wilson(3, 17)).toEqual(wilson(3, 17, 1.9599639845400543));
  });
});

describe("clusterBootstrap", () => {
  const mixed = [
    cluster("a", [1, 1, 0, 1]),
    cluster("b", [0, 0, 1]),
    cluster("c", [1, 1, 1, 1, 1]),
    cluster("d", [0, 1]),
    cluster("e", [1, 0, 0, 0, 0, 1]),
  ];

  it("is deterministic for a fixed seed and changes with the seed", () => {
    const run = (seed: string | number) =>
      clusterBootstrap({ clusters: mixed, statistic: mean, B: 2000, seed });
    expect(run("at-agent-bench")).toEqual(run("at-agent-bench"));
    expect(run(7)).toEqual(run(7));
    expect(run("at-agent-bench")).not.toEqual(run("other-seed"));
  });

  it("estimate is the statistic on all items; interval brackets it; B defaults to 10000", () => {
    const r = clusterBootstrap({ clusters: mixed, statistic: mean, seed: 1 });
    expect(r.B).toBe(10000);
    expect(r.estimate).toBeCloseTo(12 / 20, 12);
    expect(r.lower).toBeLessThan(r.estimate);
    expect(r.upper).toBeGreaterThan(r.estimate);
  });

  // Degenerate: zero events gives a zero-width interval, so report wilson/exactZeroUpper there instead.
  it("collapses to [0, 0] when every outcome is 0", () => {
    const zeros = [
      cluster("a", [0, 0, 0]),
      cluster("b", [0]),
      cluster("c", [0, 0]),
    ];
    const r = clusterBootstrap({ clusters: zeros, statistic: mean, seed: 3 });
    expect(r).toEqual({ estimate: 0, lower: 0, upper: 0, B: 10000 });
  });

  it("clusters with identical proportions give a zero-width interval at that proportion", () => {
    const same = ["a", "b", "c", "d"].map((id) => cluster(id, [1, 0, 0, 0]));
    const r = clusterBootstrap({ clusters: same, statistic: mean, seed: 5 });
    expect(r).toEqual({ estimate: 0.25, lower: 0.25, upper: 0.25, B: 10000 });
  });

  it("resamples whole clusters, not items: one all-1 and one all-0 cluster span [0, 1]", () => {
    // Replicate means are 0, 0.5, 1 with prob 1/4, 1/2, 1/4; an item-level bootstrap would give ~[0.28, 0.72].
    const split = [
      cluster("ones", Array(10).fill(1)),
      cluster("zeros", Array(10).fill(0)),
    ];
    const r = clusterBootstrap({ clusters: split, statistic: mean, seed: 11 });
    expect(r).toEqual({ estimate: 0.5, lower: 0, upper: 1, B: 10000 });
  });

  it("rejects fewer than 2 clusters with a message naming the cluster count", () => {
    expect(() =>
      clusterBootstrap({
        clusters: [cluster("only", [1, 0, 1])],
        statistic: mean,
        seed: 1,
      }),
    ).toThrow(/at least 2 clusters \(got 1\)/);
    expect(() =>
      clusterBootstrap({ clusters: [], statistic: mean, seed: 1 }),
    ).toThrow(/at least 2 clusters \(got 0\)/);
  });

  it("rejects empty input, bad B or alpha, and a non-finite replicate", () => {
    expect(() =>
      clusterBootstrap({ clusters: [], statistic: mean, seed: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      clusterBootstrap({ clusters: mixed, statistic: mean, seed: 1, B: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      clusterBootstrap({ clusters: mixed, statistic: mean, seed: 1, alpha: 1 }),
    ).toThrow(RangeError);
    // An all-empty resample makes mean() = 0/0.
    const withEmpty = [cluster("empty", []), cluster("one", [1])];
    expect(() =>
      clusterBootstrap({
        clusters: withEmpty,
        statistic: mean,
        seed: 1,
        B: 200,
      }),
    ).toThrow(/non-finite/);
  });
});
