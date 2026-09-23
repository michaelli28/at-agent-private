// Interval estimates for the detector benchmark. Pure functions, no dependencies.

export type Interval = { p: number; lower: number; upper: number };

export type Cluster<T> = { id: string; items: readonly T[] };

export type ClusterBootstrapOptions<T> = {
  clusters: readonly Cluster<T>[];
  statistic: (items: readonly T[]) => number;
  B?: number;
  seed: string | number;
  alpha?: number;
};

export type BootstrapInterval = {
  estimate: number;
  lower: number;
  upper: number;
  B: number;
};

function requireRange(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(message);
}

// The double nearest Φ⁻¹(0.975) = 1.95996398454005423552…; 1.959963984540054 is one ulp below it.
export const Z_975 = 1.9599639845400543;

// Wilson 1927: inverts the score test, solving |p̂-p| = z·sqrt(p(1-p)/n) for p.
// Counts may be non-integer so design-effect-deflated x/deff, n/deff can be passed.
export function wilson(x: number, n: number, z = Z_975): Interval {
  requireRange(
    n > 0 && x >= 0 && x <= n && z > 0,
    `wilson: need n > 0, 0 <= x <= n, z > 0 (x=${x}, n=${n}, z=${z})`,
  );
  const p = x / n;
  const z2n = (z * z) / n;
  const center = (p + z2n / 2) / (1 + z2n);
  const half = (z / (1 + z2n)) * Math.sqrt((p * (1 - p)) / n + z2n / (4 * n));
  // The bound at x=0 / x=n is exactly 0 / 1; the closed form lands an ulp off.
  return {
    p,
    lower: x === 0 ? 0 : Math.max(0, center - half),
    upper: x === n ? 1 : Math.min(1, center + half),
  };
}

// Hanley & Lippman-Hand 1983: -ln(0.05) ≈ 3, so ≈95% upper bound when 0 events in n.
export function ruleOfThree(n: number): number {
  requireRange(n > 0, `ruleOfThree: need n > 0 (n=${n})`);
  return 3 / n;
}

// Exact (Clopper-Pearson) one-sided bound at 0 events: solve (1-p)^n = alpha for p.
export function exactZeroUpper(n: number, alpha = 0.05): number {
  requireRange(
    n > 0 && alpha > 0 && alpha < 1,
    `exactZeroUpper: need n > 0, 0 < alpha < 1 (n=${n}, alpha=${alpha})`,
  );
  return 1 - Math.pow(alpha, 1 / n);
}

// Kish 1965: variance inflation for clusters of m items (mean size, may be non-integer) with intraclass correlation rho.
// Negative rho is rejected: it gives deff < 1, so effectiveN > n (claims clustering ADDS information), and deff <= 0
// once rho <= -1/(m-1). A negative ICC estimate is sampling noise here; floor it at 0 before calling.
export function designEffect(m: number, rho: number): number {
  requireRange(
    Number.isFinite(m) && m >= 1 && rho >= 0 && rho <= 1,
    `designEffect: need finite m >= 1 and rho in [0, 1] (m=${m}, rho=${rho})`,
  );
  return 1 + (m - 1) * rho;
}

// Kish 1965: the iid sample size that would give the same variance as n clustered items.
export function effectiveN(n: number, m: number, rho: number): number {
  return n / designEffect(m, rho);
}

// FNV-1a 32-bit over String(seed), so 42 and '42' give the same stream.
function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: 32-bit state, uniform in [0, 1). State kept in uint32 so it never loses precision.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hyndman-Fan type 7 (R's default): linear interpolation between order statistics.
function quantile(sorted: Float64Array, q: number): number {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// Seeded uniform [0, 1) stream for reproducible draws (clusterBootstrap, bench/spotcheck.ts).
export function seededRandom(seed: string | number): () => number {
  return mulberry32(hashSeed(seed));
}

// Efron percentile interval, resampling whole clusters with replacement so within-cluster correlation is kept.
// All-zero outcomes collapse to [0, 0]; report wilson/exactZeroUpper there instead.
// Under-covers with few clusters: print k beside every interval. Figures from ONE simulation setup, not a general law
// (p_j ~ U(0.4, 1), m = 10 items per cluster, nominal 95%): ~85% at k=5, ~91% k=10, ~93% k=20, ~94-95% k=40.
// k=2 is especially unstable: the interval is [min, max] of the two cluster means, and reruns gave 36-65%.
export function clusterBootstrap<T>(
  options: ClusterBootstrapOptions<T>,
): BootstrapInterval {
  const { clusters, statistic, B = 10000, seed, alpha = 0.05 } = options;
  requireRange(
    clusters.length >= 2,
    `clusterBootstrap: need at least 2 clusters (got ${clusters.length}); one cluster resamples to itself, a zero-width interval that looks like certainty`,
  );
  requireRange(
    Number.isInteger(B) && B > 0,
    `clusterBootstrap: need integer B > 0 (B=${B})`,
  );
  requireRange(
    alpha > 0 && alpha < 1,
    `clusterBootstrap: need 0 < alpha < 1 (alpha=${alpha})`,
  );

  const k = clusters.length;
  const rng = seededRandom(seed);
  const replicates = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    const items: T[] = [];
    for (let j = 0; j < k; j++) {
      for (const item of clusters[Math.floor(rng() * k)].items) {
        items.push(item);
      }
    }
    const value = statistic(items);
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `clusterBootstrap: statistic returned non-finite ${value} on replicate ${b}`,
      );
    }
    replicates[b] = value;
  }
  replicates.sort();

  return {
    estimate: statistic(clusters.flatMap((c) => c.items)),
    lower: quantile(replicates, alpha / 2),
    upper: quantile(replicates, 1 - alpha / 2),
    B,
  };
}
