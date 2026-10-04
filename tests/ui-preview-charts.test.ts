import { expect, test } from 'bun:test';
import { dataRows, fixtures, getChartModel, getChartPeriod, getDatasetOptions, styles, supportedMediums, tasteWeights } from '../src/routes/ui-preview/charts/data';
import type { ChartFixture, ChartMedium } from '../src/routes/ui-preview/charts/types';

const fixture = (id: string) => {
	const value = fixtures.find(fixture => fixture.id === id);
	if (!value) throw Error(`Missing fixture ${id}`);
	return value;
};
const model = (id: string, medium: ChartMedium) => getChartModel(fixture(id), medium);
const nativeModel = (fixture: ChartFixture) => {
	const medium = supportedMediums(fixture).find(medium => getChartModel(fixture, medium).raw.supplemental !== true);
	if (!medium) throw Error(`Missing original sample ${fixture.id}`);
	return getChartModel(fixture, medium);
};

test('complete preview catalog preserves every style and A/B contextual fixture without prompts or host paths', () => {
	expect(styles).toHaveLength(36);
	expect(fixtures).toHaveLength(256);
	expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(256);
	for (const style of styles) {
		expect(style.variantIds).toEqual(fixtures.filter(fixture => fixture.sourceId === style.id).map(fixture => fixture.id));
		for (const context of style.contexts) expect(fixtures.filter(fixture => fixture.sourceId === style.id && fixture.context === context).map(fixture => fixture.variant)).toEqual(['A', 'B']);
	}
	const payload = JSON.stringify({ styles, fixtures });
	expect(payload).not.toContain('/Users/');
	expect(payload).not.toContain('promptPath');
	expect(payload).not.toContain('fullPrompt');
	expect(payload).not.toContain('Use case:');
});

test('every fixture and supported media sample has bounded, finite geometry inputs and stable cached rows', () => {
	for (const fixture of fixtures) {
		for (const medium of supportedMediums(fixture)) {
			const result = getChartModel(fixture, medium);
			expect(result.rows.length).toBeGreaterThan(0);
			expect(result.rows.length).toBeLessThanOrEqual(366);
			expect(result.domain[1]).toBeGreaterThan(result.domain[0]);
			expect(result.domainY[1]).toBeGreaterThan(result.domainY[0]);
			expect([...result.domain, ...result.domainY, ...result.ticks, ...result.ticksY].every(Number.isFinite)).toBe(true);
			for (const row of result.rows) expect(row.value === null || Number.isFinite(row.value)).toBe(true);
			expect(dataRows(result)).toBe(result.rows);
			expect(getChartModel(fixture, medium)).toBe(result);
		}
		const original = nativeModel(fixture);
		for (const [key, value] of Object.entries(fixture.semanticData)) expect(original.raw[key]).toEqual(value);
	}
});

test('calendar fixtures derive actual UTC dates and distinguish missing samples from known zero', () => {
	const latency = model('4B-PA', 'Benchmarks');
	const runs = model('4B-PB', 'Benchmarks');
	expect(latency.calendar?.values[6]).toBeNull();
	expect(runs.calendar?.values[6]).toBe(0);
	expect(latency.rows[0].label).toBe('2026-09-01');
	expect(new Date(`${latency.rows[0].label}T00:00:00Z`).getUTCDay()).toBe(2);
	expect(latency.rows.at(-1)?.label).toBe('2026-09-30');
	const annual = model('4A-SA', 'Movies');
	expect(annual.calendar?.month).toBe(0);
	expect(annual.calendar?.values).toHaveLength(365);
	expect(annual.rows.at(-1)?.label).toBe('2026-12-31');
	expect(annual.notes.join(' ')).toContain('not 365 daily values');
	const matrix = model('4C-PA', 'Benchmarks');
	expect(matrix.matrix[0][1]).toBeNull();
	expect(matrix.rows[1]).toMatchObject({ label: 'Mon · 04:00 UTC', value: null });
});

test('independent taste scores preserve unknown evidence and the actual weighting model', () => {
	expect(tasteWeights).toEqual({ Ratings: 40, Genres: 30, Reactions: 20, Interests: 10 });
	const mixed = model('13A-TA', 'Screen');
	expect(mixed.rows.at(-1)).toMatchObject({ label: 'Music · Ratings', value: null, evidence: 3, medium: 'music' });
	expect(mixed.rows.map(row => row.value)).toEqual([97, 89, 84, 78, 91, null]);
	const signals = model('14C-TB', 'Screen');
	expect(signals.rows.map(row => row.value)).toEqual([80, 80, 80, 60]);
	expect(signals.total).toBeUndefined();
	const extension = model('3C-TA', 'Music');
	expect(extension.rows[2]).toMatchObject({ label: 'Reactions', value: null, evidence: 3 });
	expect(extension.unit).toBe('/100');
	expect(extension.raw.supplemental).toBe(true);
});

test('stacked samples, set overlap and histogram counts retain their declared populations', () => {
	const stacked = model('2B-TA', 'Movies');
	expect(stacked.series.map(series => series.values.reduce<number>((sum, value) => sum + (value ?? 0), 0))).toEqual([40, 40]);
	expect(stacked.notes.join(' ')).toContain('80 rating records');
	const overlap = model('5C-TB', 'Movies');
	expect(overlap.rows.map(row => row.value)).toEqual([30, 50, 20]);
	expect(overlap.total).toBe(100);
	expect(model('7A-MA', 'Movies').rows.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(120);
	expect(model('7A-TA', 'Movies').labels.at(-1)).toBe('4.5');
});

test('alluvial nodes conserve exact counts while preserving source and terminal identities', () => {
	for (const fixture of fixtures.filter(fixture => fixture.sourceId === '14A')) {
		for (const medium of supportedMediums(fixture)) {
			const sample = getChartModel(fixture, medium);
			const totals = new Map<string, { incoming: number; outgoing: number }>();
			for (const flow of sample.flows) {
				expect(flow.source).not.toBe(flow.target);
				const source = totals.get(flow.source) ?? { incoming: 0, outgoing: 0 };
				const target = totals.get(flow.target) ?? { incoming: 0, outgoing: 0 };
				source.outgoing += flow.value; target.incoming += flow.value;
				totals.set(flow.source, source); totals.set(flow.target, target);
			}
			for (const node of totals.values()) if (node.incoming && node.outgoing) expect(node.incoming).toBe(node.outgoing);
		}
	}
	expect(model('14A-MA', 'Movies').flows[0].source).toBe('Saved cohort');
	expect(model('14A-MA', 'Movies').flows.at(-1)?.target).toBe('Saved');
	expect(model('14A-MB', 'Shows').flows[0].source).toBe('Season1');
});

test('exact isotype counts correct raster defects and only declare genuine capacities', () => {
	const saved = model('14C-SB', 'Screen');
	expect(saved.rows.map(row => row.value)).toEqual([10, 6, 4]);
	expect(saved.rows.map(row => row.value! / saved.symbolUnit!)).toEqual([10, 6, 4]);
	expect(saved.rows.every(row => row.capacity === undefined)).toBe(true);
	const episodes = model('14C-MB', 'Shows');
	expect(episodes.rows.map(row => [row.value, row.capacity])).toEqual([[8, 10], [8, 10]]);
	expect(model('11A-SA', 'Movies').rows[0].capacity).toBeUndefined();
	expect(model('11A-MB', 'Shows').rows[0].capacity).toBe(62);
	expect(model('11B-MB', 'Shows').rows[0].capacity).toBe(62);
	expect(model('11A-MA', 'Movies').domain).toEqual([0.5, 5]);
});

test('media extensions use independent local fixtures with appropriate event and rating semantics', () => {
	const source = fixture('1A-SB');
	expect(source.semanticData.values).toEqual([24, 32, 28, 40, 36, 48]);
	const game = getChartModel(source, 'Games');
	expect(game.unit).toBe('recorded game plays');
	expect(game.rows.map(row => row.value)).toEqual([4, 6, 3, 8, 5, 7]);
	expect(game.raw.supplemental).toBe(true);
	expect(game.notes.join(' ')).toContain('source variant values remain preserved');
	const comparison = model('2C-TA', 'Games');
	expect(comparison.unit).toBe('stars');
	expect(comparison.rows.map(row => row.value)).toEqual([0.5, 1, -0.5, -1.5]);
	const scatter = model('5A-SA', 'Movies');
	expect(scatter.rows[0]).toMatchObject({ valueUnit: 'stars', referenceUnit: 'watches' });
	expect(model('9A-PA', 'Benchmarks').rows[0]).toMatchObject({ value: 4, valueUnit: 'September day' });
	expect(model('9B-MB', 'Shows').raw.asOf).toBe('2026-09-22');
	expect(model('9B-MB', 'Games').raw.asOf).toBeUndefined();
	expect(model('2C-PB', 'Benchmarks').raw.lowerIsBetter).toBe(true);
});

test('dataset controls have short truthful names for every source and supported medium', () => {
	for (const fixture of fixtures) for (const medium of supportedMediums(fixture)) {
		const options = getDatasetOptions(fixture.sourceId, fixture.context, medium);
		expect(options.map(option => option.value)).toEqual(['A', 'B']);
		expect(new Set(options.map(option => option.label)).size).toBe(2);
		for (const option of options) {
			expect(option.label.length).toBeGreaterThan(0);
			expect(option.label.split(/\s+/).length).toBeLessThanOrEqual(4);
			expect(option.label).not.toMatch(/^Dataset [AB]$/);
		}
	}
	expect(getDatasetOptions('2C', 'P', 'Benchmarks').map(option => option.label)).toEqual(['Latency change', 'Memory change']);
	expect(getDatasetOptions('14B', 'S', 'Movies').map(option => option.label)).toEqual(['Annual activity A', 'Annual activity B']);
	expect(getDatasetOptions('9B', 'M', 'Shows').map(option => option.label)).toEqual(['Journal moments', 'Season premieres']);
});

test('compact periods use explicit fixture dates and keep non-temporal taste comparisons undated', () => {
	expect(getChartPeriod(model('14B-SB', 'Movies'))).toBe('2026');
	expect(getChartPeriod(model('4B-PA', 'Benchmarks'))).toBe('Sep 2026');
	expect(getChartPeriod(model('4C-SA', 'Music'))).toBe('3 Jul–30 Sep 2026');
	expect(getChartPeriod(model('9B-MB', 'Shows'))).toBe('As of 22 Sep 2026');
	expect(getChartPeriod(model('6A-SB', 'Movies'))).toBe('Sep 2025–Aug 2026 · Sep 2026 current');
	expect(getChartPeriod(model('13A-TA', 'Screen'))).toBe('');
	expect(getChartPeriod(model('13A-TA', 'Music'))).toBe('');
	expect(getChartPeriod(model('8A-TA', 'Music'))).toBe('Apr–Sep 2026');
	const undated = { ...model('9A-SA', 'Movies'), raw: {}, subtitle: '', events: [{ label: 'Unknown date', day: 0, detail: 'Undated event' }] };
	expect(getChartPeriod(undated)).toBe('');
	expect(getChartPeriod(model('2C-SA', 'Movies'))).toBe('Aug–Sep 2026');
	expect(getChartPeriod(model('2C-SB', 'Shows'))).toBe('Aug–Sep 2026');
	expect(getChartPeriod(model('5B-SA', 'Movies'))).toBe('Aug–Sep 2026');
	expect(getChartPeriod(model('1C-SA', 'Screen'))).toBe('Apr–Sep');
	expect(getChartPeriod(model('6B-PA', 'Benchmarks'))).toBe('10–30 Sep');
	expect(getChartPeriod(model('1A-PA', 'Benchmarks'))).toBe('5–30 Sep');
});
