import { computeSegments, computeComparisonBars, computePieSlices, SvgSegment } from './svg-util';

describe('computeSegments', () => {
  const WIDTH = 100;

  describe('segment ordering and types', () => {
    it('first segment is type "work"', () => {
      const segs = computeSegments([10, 20], [30], WIDTH);
      expect(segs[0].type).toBe('work');
    });

    it('last segment is type "work"', () => {
      const segs = computeSegments([10, 20], [30], WIDTH);
      expect(segs[segs.length - 1].type).toBe('work');
    });

    it('produces N work segments and N-1 wait segments for N steps', () => {
      const works = [10, 20, 30];
      const waits = [5, 15];
      const segs = computeSegments(works, waits, WIDTH);
      const workSegs = segs.filter((s) => s.type === 'work');
      const waitSegs = segs.filter((s) => s.type === 'wait');
      expect(workSegs.length).toBe(3);
      expect(waitSegs.length).toBe(2);
    });

    it('interleaves work and wait: work, wait, work, wait, work', () => {
      const segs = computeSegments([10, 20, 30], [5, 15], WIDTH);
      expect(segs.map((s) => s.type)).toEqual(['work', 'wait', 'work', 'wait', 'work']);
    });

    it('produces 1 work segment and 0 wait segments for a single step', () => {
      const segs = computeSegments([60], [], WIDTH);
      expect(segs.length).toBe(1);
      expect(segs[0].type).toBe('work');
    });
  });

  describe('segment widths', () => {
    it('widths sum to the given width when total > 0', () => {
      const works = [60, 120, 60];
      const waits = [240, 480];
      const segs = computeSegments(works, waits, WIDTH);
      const totalWidth = segs.reduce((sum, s) => sum + s.width, 0);
      expect(totalWidth).toBeCloseTo(WIDTH, 5);
    });

    it('widths are proportional to each segment share of process total (no zero segments)', () => {
      const works = [100, 50];
      const waits = [50];
      // total = 200; work[0]=100→50%, wait[0]=50→25%, work[1]=50→25%
      const segs = computeSegments(works, waits, WIDTH);
      expect(segs[0].width).toBeCloseTo(50, 5);
      expect(segs[1].width).toBeCloseTo(25, 5);
      expect(segs[2].width).toBeCloseTo(25, 5);
    });

    it('falls back to equal-width work segments when process total is 0, with waits at 0 width', () => {
      const segs = computeSegments([0, 0], [0], WIDTH);
      const workSegs = segs.filter((s) => s.type === 'work');
      const waitSegs = segs.filter((s) => s.type === 'wait');
      workSegs.forEach((s) => expect(s.width).toBeCloseTo(WIDTH / 2, 5));
      waitSegs.forEach((s) => expect(s.width).toBe(0));
    });
  });

  describe('0-minute work segment floor (REQ-104)', () => {
    it('gives a 0-minute work segment the 3-unit floor out of a 600-unit bar', () => {
      const segs = computeSegments([0, 100], [0], 600);
      const workSegs = segs.filter((s) => s.type === 'work');
      expect(workSegs[0].width).toBeCloseTo(3, 5);
    });

    it('keeps a 0-minute wait segment at 0 width even when total > 0 and a work floor applies', () => {
      const segs = computeSegments([0, 100], [0], 600);
      const waitSegs = segs.filter((s) => s.type === 'wait');
      expect(waitSegs[0].width).toBe(0);
    });

    it('non-zero segments keep correct relative proportions to each other alongside a floored segment', () => {
      const works = [100, 0, 50];
      const waits = [0, 0];
      const segs = computeSegments(works, waits, WIDTH);
      const workSegs = segs.filter((s) => s.type === 'work');
      // work[0]=100 and work[2]=50 carried a 2:1 ratio before flooring; they must still.
      expect(workSegs[0].width / workSegs[2].width).toBeCloseTo(2, 5);
    });

    it('reserve for all 0-minute work floors sums to exactly 150 units at the 50-step cap (600-unit bar)', () => {
      const works = new Array(50).fill(0);
      const waits = new Array(49).fill(0);
      waits[0] = 100; // keep total > 0 so the floor path (not the zero-total fallback) runs
      const segs = computeSegments(works, waits, 600);
      const workWidthSum = segs.filter((s) => s.type === 'work').reduce((sum, s) => sum + s.width, 0);
      expect(workWidthSum).toBeCloseTo(150, 5);
      segs
        .filter((s) => s.type === 'work')
        .forEach((s) => {
          expect(s.width).toBeCloseTo(3, 5);
          expect(s.width).toBeGreaterThan(0);
        });
    });

    it('shrinks each floored segment proportionally when the naive floor total would exceed the 150-unit cap', () => {
      const works = new Array(60).fill(0);
      const waits = new Array(59).fill(0);
      waits[0] = 100; // total > 0
      const segs = computeSegments(works, waits, 600);
      const workSegs = segs.filter((s) => s.type === 'work');
      const workWidthSum = workSegs.reduce((sum, s) => sum + s.width, 0);
      // naive floor would be 60 * 3 = 180, over the 150-unit cap, so each floored
      // segment shrinks to 150 / 60 = 2.5.
      expect(workWidthSum).toBeCloseTo(150, 5);
      workSegs.forEach((s) => expect(s.width).toBeCloseTo(2.5, 5));
    });
  });

  describe('segment x positions', () => {
    it('first segment starts at x=0', () => {
      const segs = computeSegments([10, 20], [30], WIDTH);
      expect(segs[0].x).toBe(0);
    });

    it('each segment x equals the sum of all previous widths', () => {
      const works = [60, 60];
      const waits = [120];
      const segs = computeSegments(works, waits, WIDTH);
      // total=240; work[0]=60→25%, wait[0]=120→50%, work[1]=60→25%
      expect(segs[0].x).toBeCloseTo(0, 5);
      expect(segs[1].x).toBeCloseTo(25, 5);
      expect(segs[2].x).toBeCloseTo(75, 5);
    });
  });

  describe('segment indices', () => {
    it('assigns index matching the step position for work segments', () => {
      const segs = computeSegments([10, 20, 30], [5, 15], WIDTH);
      const workSegs = segs.filter((s) => s.type === 'work');
      expect(workSegs[0].index).toBe(0);
      expect(workSegs[1].index).toBe(1);
      expect(workSegs[2].index).toBe(2);
    });

    it('assigns index matching the gap position for wait segments', () => {
      const segs = computeSegments([10, 20, 30], [5, 15], WIDTH);
      const waitSegs = segs.filter((s) => s.type === 'wait');
      expect(waitSegs[0].index).toBe(0);
      expect(waitSegs[1].index).toBe(1);
    });
  });
});

describe('computeComparisonBars', () => {
  const WIDTH = 200;

  it('maps the largest total to full width', () => {
    const bars = computeComparisonBars([100, 50, 25], WIDTH);
    expect(bars[0].width).toBeCloseTo(WIDTH, 5);
  });

  it('maps smaller totals proportionally', () => {
    const bars = computeComparisonBars([100, 50, 25], WIDTH);
    expect(bars[1].width).toBeCloseTo(100, 5);
    expect(bars[2].width).toBeCloseTo(50, 5);
  });

  it('all widths are 0 when all totals are 0', () => {
    const bars = computeComparisonBars([0, 0, 0], WIDTH);
    bars.forEach((b) => expect(b.width).toBe(0));
  });

  it('returns one bar per total', () => {
    const bars = computeComparisonBars([10, 20, 30], WIDTH);
    expect(bars.length).toBe(3);
  });

  it('maps a single total to full width', () => {
    const bars = computeComparisonBars([42], WIDTH);
    expect(bars[0].width).toBeCloseTo(WIDTH, 5);
  });

  it('a total of 0 maps to 0 width when other totals are non-zero', () => {
    const bars = computeComparisonBars([100, 0], WIDTH);
    expect(bars[1].width).toBeCloseTo(0, 5);
  });

  it('uses width of 0 for an empty totals array', () => {
    const bars = computeComparisonBars([], WIDTH);
    expect(bars.length).toBe(0);
  });
});

describe('computePieSlices', () => {
  const CX = 50;
  const CY = 50;
  const R = 45;

  describe('2-slice pie (Pie A: work vs. wait)', () => {
    const result = computePieSlices(
      [
        { key: 'work', value: 70, color: '#264892', label: 'Arbeit' },
        { key: 'wait', value: 30, color: '#cf944f', label: 'Wartezeit' },
      ],
      CX,
      CY,
      R,
    );

    it('returns one slice per input', () => {
      expect(result.slices.length).toBe(2);
    });

    it('is not empty and not a full circle', () => {
      expect(result.isEmpty).toBeFalse();
      expect(result.isFullCircle).toBeFalse();
    });

    it('gives every slice a non-empty SVG path', () => {
      result.slices.forEach((s) => expect(s.path.length).toBeGreaterThan(0));
    });

    it('percentages sum to 100 (rounded to 1 decimal each)', () => {
      const total = result.slices.reduce((sum, s) => sum + s.percent, 0);
      expect(total).toBeCloseTo(100, 5);
    });
  });

  describe('3-slice pie (Pie B: role split)', () => {
    const result = computePieSlices(
      [
        { key: 'ba', value: 180, color: '#6f42c1', label: 'BA' },
        { key: 'dev', value: 640, color: '#0f766e', label: 'Dev' },
        { key: 'tester', value: 180, color: '#9a6700', label: 'Tester' },
      ],
      CX,
      CY,
      R,
    );

    it('returns one slice per input', () => {
      expect(result.slices.length).toBe(3);
    });

    it('is not empty and not a full circle', () => {
      expect(result.isEmpty).toBeFalse();
      expect(result.isFullCircle).toBeFalse();
    });

    it('gives every slice a non-empty SVG path', () => {
      result.slices.forEach((s) => expect(s.path.length).toBeGreaterThan(0));
    });
  });

  describe('zero-total pie', () => {
    const result = computePieSlices(
      [
        { key: 'work', value: 0, color: '#264892', label: 'Arbeit' },
        { key: 'wait', value: 0, color: '#cf944f', label: 'Wartezeit' },
      ],
      CX,
      CY,
      R,
    );

    it('sets isEmpty to true', () => {
      expect(result.isEmpty).toBeTrue();
    });

    it('is not a full circle', () => {
      expect(result.isFullCircle).toBeFalse();
    });

    it('gives every slice an empty path (caller renders a grey circle instead)', () => {
      result.slices.forEach((s) => expect(s.path).toBe(''));
    });
  });

  describe('single-100%-slice pie', () => {
    const result = computePieSlices(
      [
        { key: 'work', value: 90, color: '#264892', label: 'Arbeit' },
        { key: 'wait', value: 0, color: '#cf944f', label: 'Wartezeit' },
      ],
      CX,
      CY,
      R,
    );

    it('sets isFullCircle to true', () => {
      expect(result.isFullCircle).toBeTrue();
    });

    it('is not empty', () => {
      expect(result.isEmpty).toBeFalse();
    });

    it('reports the sole 100% slice color as fullCircleColor', () => {
      expect(result.fullCircleColor).toBe('#264892');
    });

    it('gives every slice an empty path (caller renders a plain circle instead of a 360° arc)', () => {
      result.slices.forEach((s) => expect(s.path).toBe(''));
    });
  });

  describe('small-share rounding (~3% of the Agile-mit-KI total)', () => {
    it('rounds a 90-of-2,970 share to "3.0", not "0"', () => {
      const result = computePieSlices(
        [
          { key: 'work', value: 90, color: '#264892', label: 'Arbeit' },
          { key: 'wait', value: 2880, color: '#cf944f', label: 'Wartezeit' },
        ],
        CX,
        CY,
        R,
      );

      const workSlice = result.slices.find((s) => s.key === 'work');
      expect(workSlice?.percent.toFixed(1)).toBe('3.0');
    });
  });
});
