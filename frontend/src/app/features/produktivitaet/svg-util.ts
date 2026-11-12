export interface SvgSegment {
  x: number;
  width: number;
  type: 'work' | 'wait';
  index: number;
}

export interface ComparisonBar {
  width: number;
}

/**
 * Minimum width reserved for a 0-minute work segment, expressed as a ratio of the
 * caller's `width` (so it lands exactly on 3 units for the real 600-unit viewBox,
 * per REQ-104, but still scales sensibly for any width passed in tests).
 */
const WORK_ZERO_FLOOR_RATIO = 3 / 600;

/**
 * Cap on the total width reserved for 0-minute work floors, expressed as a ratio of
 * `width` (lands on 150 units — a quarter of the real 600-unit viewBox). At the
 * REQ-106 cap of 50 steps, 50 floors of 3 units land exactly on this cap, so it only
 * ever bites if the step cap changes later.
 */
const MAX_FLOOR_RESERVE_RATIO = 150 / 600;

/**
 * Computes SVG segments for a single process bar.
 * Ordering: work(0), wait(0), work(1), wait(1), ..., work(N-1).
 * N work segments + N-1 wait segments. First and last are always work.
 *
 * Widths are proportional to each segment's share of the process total, with two
 * exceptions so a step is never invisible (REQ-104):
 * - A 0-minute work segment gets a minimum floor width (see `WORK_ZERO_FLOOR_RATIO`).
 *   The remaining width is then distributed proportionally among the segments that
 *   carry real minutes, so their widths keep the correct relative proportions to each
 *   other. The total floor reserve is capped (see `MAX_FLOOR_RESERVE_RATIO`); if the
 *   naive floor total would exceed the cap, every floored segment shrinks
 *   proportionally so the reserve sums to exactly the cap. 0-minute wait segments are
 *   never floored — a wait is not a step and needs no marker.
 * - When the process total is exactly 0 (every work and every wait at 0 minutes),
 *   proportional math has nothing to divide by. Falls back to equal-width work
 *   segments filling the whole bar, with every wait segment at 0 width.
 */
export function computeSegments(
  works: number[],
  waits: number[],
  width: number,
): SvgSegment[] {
  const total = works.reduce((s, v) => s + v, 0) + waits.reduce((s, v) => s + v, 0);

  if (total === 0) {
    return computeZeroTotalFallbackSegments(works, waits, width);
  }

  const zeroWorkCount = works.filter((w) => w === 0).length;
  const naiveReserve = zeroWorkCount * (width * WORK_ZERO_FLOOR_RATIO);
  const maxReserve = width * MAX_FLOOR_RESERVE_RATIO;
  const reserve = Math.min(naiveReserve, maxReserve);
  const floorPerZeroSegment = zeroWorkCount > 0 ? reserve / zeroWorkCount : 0;
  const remainingWidth = width - reserve;

  const segments: SvgSegment[] = [];
  let x = 0;

  for (let i = 0; i < works.length; i++) {
    const segWidth = works[i] > 0 ? (works[i] / total) * remainingWidth : floorPerZeroSegment;
    segments.push({ x, width: segWidth, type: 'work', index: i });
    x += segWidth;

    if (i < waits.length) {
      const waitWidth = waits[i] > 0 ? (waits[i] / total) * remainingWidth : 0;
      segments.push({ x, width: waitWidth, type: 'wait', index: i });
      x += waitWidth;
    }
  }

  return segments;
}

/**
 * Degenerate-total fallback (every work and every wait at 0 minutes): there is
 * nothing to distribute proportionally, so every work segment gets an equal share of
 * the whole bar and every wait segment stays at 0 width. Keeps the bar visible and
 * every step focusable instead of collapsing to nothing.
 */
function computeZeroTotalFallbackSegments(works: number[], waits: number[], width: number): SvgSegment[] {
  const segWidth = works.length > 0 ? width / works.length : 0;
  const segments: SvgSegment[] = [];
  let x = 0;

  for (let i = 0; i < works.length; i++) {
    segments.push({ x, width: segWidth, type: 'work', index: i });
    x += segWidth;

    if (i < waits.length) {
      segments.push({ x, width: 0, type: 'wait', index: i });
    }
  }

  return segments;
}

/**
 * Computes comparison bar widths for multiple processes on a shared scale.
 * The largest total maps to full width; others are proportional.
 * If all totals are zero, all widths are zero.
 */
export function computeComparisonBars(totals: number[], width: number): ComparisonBar[] {
  const maxTotal = Math.max(...totals, 0);
  return totals.map((total) => ({
    width: maxTotal > 0 ? (total / maxTotal) * width : 0,
  }));
}

/** A single named value to render as a pie slice. */
export interface PieSliceInput {
  key: string;
  value: number;
  color: string;
  label: string;
}

/** A computed pie slice: the input plus its rendered path and rounded percent share. */
export interface PieSlice extends PieSliceInput {
  /** SVG path `d` for this slice's wedge. Empty when the pie isEmpty/isFullCircle
   *  (the caller renders a plain `<circle>` in both of those cases instead). */
  path: string;
  /** This slice's share of the total, rounded to 1 decimal (so a ~3% share reads "3.0", not "0"). */
  percent: number;
  /** Centroid for an in-slice text label (white percent number). */
  labelX: number;
  labelY: number;
  /** Only show the in-slice label when the wedge is big enough to fit it (tiny slices rely on the legend). */
  showLabel: boolean;
}

export interface PieResult {
  slices: PieSlice[];
  /** True when every slice's value is 0 — nothing to show (caller renders a grey "Keine Daten" circle). */
  isEmpty: boolean;
  /** True when exactly one slice carries the whole total — a 360° arc degenerates to a point,
   *  so the caller renders a plain `<circle>` instead of a path. */
  isFullCircle: boolean;
  /** The color of the sole 100% slice when isFullCircle is true; undefined otherwise. */
  fullCircleColor?: string;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

/** Builds the SVG path `d` for one pie wedge, clockwise from startAngle to endAngle (degrees, 0 = 12 o'clock). */
function describePieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
    `A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

/**
 * Computes SVG pie-slice paths and percentages for a set of named values, centered
 * at (cx, cy) with radius r. Pure and deterministic — same inputs always produce the
 * same output, so this is directly unit-testable without a DOM.
 *
 * - `isEmpty` is true when the total is 0 (all slice paths are '').
 * - `isFullCircle` is true when a single slice carries 100% of the total — a 360° arc
 *   degenerates to a zero-length path, so callers must render a `<circle>` instead.
 * - Percent is rounded to 1 decimal so small shares (~3%) still show as non-zero.
 */
export function computePieSlices(slices: PieSliceInput[], cx: number, cy: number, r: number): PieResult {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return {
      slices: slices.map((s) => ({ ...s, path: '', percent: 0, labelX: cx, labelY: cy, showLabel: false })),
      isEmpty: true,
      isFullCircle: false,
    };
  }

  const isFullCircle = slices.filter((s) => s.value > 0).length === 1;

  let angle = 0;
  const computed = slices.map((s) => {
    const fraction = s.value / total;
    const percent = Math.round(fraction * 1000) / 10;
    const startAngle = angle;
    const endAngle = angle + fraction * 360;
    angle = endAngle;
    const full = isFullCircle && s.value > 0;
    const path = !isFullCircle && s.value > 0 ? describePieSlicePath(cx, cy, r, startAngle, endAngle) : '';
    // In-slice label centroid: centre of the wedge for a normal slice, dead centre for a full circle.
    const labelPos = full ? { x: cx, y: cy } : polarToCartesian(cx, cy, r * 0.6, (startAngle + endAngle) / 2);
    const showLabel = s.value > 0 && (full || fraction >= 0.08);
    return { ...s, path, percent, labelX: labelPos.x, labelY: labelPos.y, showLabel };
  });

  const fullCircleColor = isFullCircle ? computed.find((s) => s.value > 0)?.color : undefined;

  return { slices: computed, isEmpty: false, isFullCircle, fullCircleColor };
}
