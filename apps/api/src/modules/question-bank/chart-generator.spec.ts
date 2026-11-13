import { CHART_SERIES_LENGTH, CHART_TEMPLATES, type ChartTemplateKey } from '@candle/shared';
import { generateChart } from './chart-generator';

/**
 * Seeded chart generator tests (docs/08 §3.4, Phase 8 Stage 1).
 * The generator is pure: determinism, fixed length, bounds, and the
 * per-template shape promises are pinned here by sweeping seeds.
 */
describe('generateChart (docs/08 §3.4)', () => {
  it('is deterministic: the same seed + template + instrument replays the same chart', () => {
    const a = generateChart('qb-571', 'STEADY_RISE', 'Meadow Foods');
    const b = generateChart('qb-571', 'STEADY_RISE', 'Meadow Foods');
    expect(a).toEqual(b);
    const c = generateChart('qb-572', 'STEADY_RISE', 'Meadow Foods');
    expect(c.series).not.toEqual(a.series);
  });

  it('always produces 6 points, 6 labels, finite positive values, and labels', () => {
    for (const template of CHART_TEMPLATES) {
      for (let n = 0; n < 50; n++) {
        const chart = generateChart(`seed-${template}-${n}`, template, 'Meadow Foods');
        expect(chart.series).toHaveLength(CHART_SERIES_LENGTH);
        expect(chart.xLabels).toHaveLength(CHART_SERIES_LENGTH);
        for (const v of chart.series) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
        expect(chart.title).toContain('Meadow Foods');
        expect(chart.instrument).toBe('Meadow Foods');
        expect(chart.xLabel.trim().length).toBeGreaterThan(0);
        expect(chart.yLabel.trim().length).toBeGreaterThan(0);
        for (const label of chart.xLabels) expect(label.trim().length).toBeGreaterThan(0);
        expect(chart.annotation.zoneStart).toBeGreaterThanOrEqual(0);
        expect(chart.annotation.zoneEnd).toBeLessThanOrEqual(5);
        expect(chart.annotation.zoneStart).toBeLessThanOrEqual(chart.annotation.zoneEnd);
      }
    }
  });

  it('STEADY_RISE climbs every step and ends clearly above the start', () => {
    for (let n = 0; n < 200; n++) {
      const { series } = generateChart(`rise-${n}`, 'STEADY_RISE', 'Meadow Foods');
      for (let i = 1; i < series.length; i++) {
        expect(series[i] as number).toBeGreaterThan(series[i - 1] as number);
      }
      expect(series[5] as number).toBeGreaterThan((series[0] as number) * 1.1);
    }
  });

  it('STEADY_FALL drops every step and ends clearly below the start', () => {
    for (let n = 0; n < 200; n++) {
      const { series } = generateChart(`fall-${n}`, 'STEADY_FALL', 'Meadow Foods');
      for (let i = 1; i < series.length; i++) {
        expect(series[i] as number).toBeLessThan(series[i - 1] as number);
      }
      expect(series[5] as number).toBeLessThan((series[0] as number) * 0.9);
    }
  });

  it('VOLATILE_FLAT swings but ends near where it started', () => {
    for (let n = 0; n < 200; n++) {
      const { series } = generateChart(`flat-${n}`, 'VOLATILE_FLAT', 'Meadow Foods');
      const first = series[0] as number;
      const last = series[5] as number;
      expect(Math.abs(last - first) / first).toBeLessThanOrEqual(0.1);
      // It actually moves: the range is at least 5% of the start.
      const range = Math.max(...series) - Math.min(...series);
      expect(range / first).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('SHARP_FALL_RECOVERY troughs mid-series and ends above the trough but below the start', () => {
    for (let n = 0; n < 200; n++) {
      const { series } = generateChart(`recovery-${n}`, 'SHARP_FALL_RECOVERY', 'Meadow Foods');
      const min = Math.min(...series);
      const minIndex = series.indexOf(min);
      expect(minIndex).toBeGreaterThanOrEqual(1);
      expect(minIndex).toBeLessThanOrEqual(3);
      expect(series[5] as number).toBeGreaterThan(min);
      expect(series[5] as number).toBeLessThan(series[0] as number);
    }
  });

  it('SPIKE_THEN_FALL peaks mid-series and ends below the start', () => {
    for (let n = 0; n < 200; n++) {
      const { series } = generateChart(`spike-${n}`, 'SPIKE_THEN_FALL', 'Meadow Foods');
      const max = Math.max(...series);
      const maxIndex = series.indexOf(max);
      expect(maxIndex).toBeGreaterThanOrEqual(1);
      expect(maxIndex).toBeLessThanOrEqual(4);
      expect(series[5] as number).toBeLessThan(series[0] as number);
    }
  });

  it('annotations match their template (trend + zone)', () => {
    const rise = generateChart('ann-rise', 'STEADY_RISE', 'Meadow Foods');
    expect(rise.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    const fall = generateChart('ann-fall', 'STEADY_FALL', 'Meadow Foods');
    expect(fall.annotation).toEqual({ trend: 'falling', zoneStart: 0, zoneEnd: 5 });
    const recovery = generateChart('ann-rec', 'SHARP_FALL_RECOVERY', 'Meadow Foods');
    expect(recovery.annotation).toEqual({ trend: 'volatile', zoneStart: 0, zoneEnd: 2 });
    const spike = generateChart('ann-spike', 'SPIKE_THEN_FALL', 'Meadow Foods');
    expect(spike.annotation.trend).toBe('volatile');
    expect(spike.annotation.zoneEnd - spike.annotation.zoneStart).toBeLessThanOrEqual(2);
  });

  it('generates no real ticker names: the chart JSON carries only the fictional instrument', () => {
    const realNames = ['RELIANCE', 'TCS', 'INFY', 'INFOSYS', 'HDFC', 'NIFTY', 'SENSEX'];
    for (const template of CHART_TEMPLATES as readonly ChartTemplateKey[]) {
      const chart = generateChart(`names-${template}`, template, 'Meadow Foods');
      const text = JSON.stringify(chart);
      for (const name of realNames) expect(text).not.toContain(name);
    }
  });

  it('respects explicit options (start, labels, title, axis labels)', () => {
    const chart = generateChart('opts-1', 'STEADY_RISE', 'Meadow Foods', {
      start: 100,
      xLabels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
      title: 'Custom title',
      xLabel: 'Week',
      yLabel: 'Value (₹)',
    });
    expect(chart.series[0]).toBe(100);
    expect(chart.xLabels).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'W6']);
    expect(chart.title).toBe('Custom title');
    expect(chart.xLabel).toBe('Week');
    expect(chart.yLabel).toBe('Value (₹)');
  });

  it('throws on an unknown template, an empty instrument, or a bad start', () => {
    expect(() =>
      generateChart('bad-1', 'NOT_A_TEMPLATE' as ChartTemplateKey, 'Meadow Foods')
    ).toThrow('Unknown chart template');
    expect(() => generateChart('bad-2', 'STEADY_RISE', '   ')).toThrow('fictional instrument name');
    expect(() => generateChart('bad-3', 'STEADY_RISE', 'Meadow Foods', { start: 0 })).toThrow(
      'positive number'
    );
  });
});
