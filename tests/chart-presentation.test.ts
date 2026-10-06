import { describe, expect, test } from 'bun:test';
import { chartCategoryColor, chartMediumColor } from '../src/lib/ui/charts/types';
import { chartRowContext, chartRowSummary } from '../src/routes/ui-preview/charts/presentation';

describe('chart presentation preserves meaning', () => {
  test('category identity survives reordering and medium aliases', () => {
    const labels = ['Drama', 'Animation', 'Sci-fi'];
    const forward = new Map(labels.map(label => [label, chartCategoryColor(label)]));
    for (const label of labels.toReversed()) expect(chartCategoryColor(label)).toBe(forward.get(label)!);
    expect(chartCategoryColor('  DRAMA  ')).toBe(chartCategoryColor('Drama'));
    expect(chartMediumColor('Movies')).toBe(chartCategoryColor('Watching'));
    expect(chartMediumColor('Games')).toBe(chartCategoryColor('Playing'));
    expect(chartMediumColor('Music')).toBe(chartCategoryColor('Listening'));
    expect(chartMediumColor('Shows')).toBe(chartCategoryColor('Episodes'));
    expect(chartMediumColor('Benchmarks')).toBeUndefined();
  });
  test('inspection suppresses repeats while retaining evidence, references and uncertainty', () => {
    expect(chartRowContext({label:'Genres',value:97,evidence:30,detail:'30 evidence observations'},'score')).toBe('30 evidence items');
    expect(chartRowSummary({label:'Request',value:68,detail:'68 · -62%',reference:180}, {unit:'ms',series:[]})).toBe('68 ms · -62% · Reference 180 ms');
    expect(chartRowSummary({label:'Ratings',value:null,evidence:3,detail:'Insufficient evidence'}, {unit:'score',series:[]})).toBe('Unknown · Insufficient evidence · 3 evidence items');
    expect(chartRowSummary({label:'Episodes',value:30,capacity:60}, {unit:'episodes',series:[]})).toBe('30 / 60 episodes');
    expect(chartRowSummary({label:'Rating',value:4.5}, {unit:'stars',series:[]})).toBe('4.5 stars');
  });
});
