import catalog from './catalog.json';
import type { ChartContext, ChartDataset, ChartFixture, ChartMedium, ChartModel, ChartRow, ChartStyle } from './types';

/** This catalog belongs exclusively to the lazy UI-preview route. Every value is fictional. */
export const styles = catalog.styles as ChartStyle[];
export const fixtures = catalog.fixtures as ChartFixture[];
export const contextOptions: { value: ChartContext; label: string }[] = [
	{ value: 'P', label: 'Benchmarks' }, { value: 'T', label: 'Taste comparisons' },
	{ value: 'S', label: 'Personal profile' }, { value: 'M', label: 'Media statistics' }
];
export const datasetOptions: { value: ChartDataset; label: string }[] = [{ value: 'A', label: 'Dataset A' }, { value: 'B', label: 'Dataset B' }];
export const tasteWeights = { Ratings: 40, Genres: 30, Reactions: 20, Interests: 10 } as const;

type Raw = Record<string, unknown>;
const media: ChartMedium[] = ['Movies', 'Shows', 'Games', 'Music'];
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const cache = new Map<string, ChartModel>();
const record = (value: unknown): Raw => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const numeric = (value: unknown, fallback = 0) => number(value) ?? fallback;
const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const strings = (value: unknown) => array(value).map(String);
const numbers = (value: unknown) => array(value).map(number);
const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const parseTicks = (value: unknown): number[] => (typeof value === 'string' ? value.split(',').map(Number) : numbers(value)).filter((v): v is number => v !== null && Number.isFinite(v));
const extent = (values: (number | null)[], origin = 0): [number, number] => {
	const known = values.filter((value): value is number => value !== null);
	return [Math.min(origin, ...known), Math.max(origin + 1, ...known)];
};
const makeTicks = ([min, max]: [number, number]) => Array.from({ length: 5 }, (_, index) => min + (max - min) * index / 4);

/** Native medium is inferred from the actual fixture semantics, not loose reuse suggestions. */
function nativeMedium(fixture: ChartFixture): ChartMedium {
	if (fixture.context === 'P') return 'Benchmarks';
	const raw = fixture.semanticData;
	if (fixture.sourceId === '3C' && fixture.context === 'S') return fixture.variant === 'A' ? 'Shows' : 'Screen';
	if (['1C', '2B'].includes(fixture.sourceId) && fixture.context === 'S') return 'Screen';
	if (['3A', '4A', '4B', '4C'].includes(fixture.sourceId) && fixture.context === 'S' && fixture.variant === 'A') return 'Screen';
	if (fixture.id === '2A-SB') return 'Movies';
	if (fixture.sourceId === '6C' && fixture.id.endsWith('SB')) return 'Screen';
	if (['10A', '10B'].includes(fixture.sourceId) && fixture.context === 'S') return fixture.variant === 'B' ? 'Music' : 'Screen';
	if (fixture.sourceId === '11A' && fixture.id.endsWith('SB')) return 'Music';
	if (fixture.id === '11A-TB') return 'Music';
	if (fixture.id === '11B-TA') return 'Screen';
	if (fixture.id === '11B-TB') return 'Games';
	if (fixture.sourceId === '11B' && fixture.id.endsWith('SA')) return 'Games';
	if (fixture.sourceId === '11B' && fixture.id.endsWith('SB')) return 'Music';
	if (fixture.sourceId === '12A' && fixture.id.endsWith('SB')) return 'Games';
	if (fixture.sourceId === '12B' && fixture.id.endsWith('SB')) return 'Music';
	if (fixture.sourceId.startsWith('13') && fixture.context === 'S') return 'Screen';
	if (['14A', '14B', '14C'].includes(fixture.sourceId) && fixture.context === 'S' && fixture.variant === 'A') return 'Screen';
	if (fixture.sourceId === '14A' && fixture.id.endsWith('SB')) return 'Screen';
	if (fixture.sourceId === '14C' && (fixture.context === 'T' || fixture.id.endsWith('SB'))) return 'Screen';
	if (fixture.sourceId.startsWith('13') && fixture.context === 'T') return 'Screen';
	if (fixture.sourceId === '14B' && fixture.id.endsWith('SB')) return 'Shows';
	if (fixture.sourceId === '5A' && fixture.id.endsWith('SB')) return 'Movies';
	if (string(raw.unit).includes('album')) return 'Music';
	if (string(raw.unit).includes('game')) return 'Games';
	if (raw.show || string(raw.unit).includes('episode')) return 'Shows';
	if (raw.movie || fixture.context === 'M') return fixture.variant === 'B' ? 'Shows' : 'Movies';
	if (fixture.context === 'T') return 'Movies';
	return fixture.variant === 'B' ? 'Shows' : 'Movies';
}

const supplementalStyles = new Set([
	'1A', '1B', '1C', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C',
	'5A', '5B', '5C', '6A', '6B', '6C', '7A', '7B', '8A', '8B', '9A', '9B',
	'10A', '10B', '11A', '11B', '12A', '12B', '13A', '13B', '13C', '14A', '14B', '14C'
]);

export function supportedMediums(fixture: ChartFixture): ChartMedium[] {
	if (fixture.context === 'P') return ['Benchmarks'];
	const native = nativeMedium(fixture);
	return supplementalStyles.has(fixture.sourceId)
		? [...(native === 'Screen' ? ['Screen' as const] : []), ...media]
		: [native];
}

const supplementalMedia = {
	Movies: { noun: 'movies', unit: 'movie watches', event: 'Watched', title: 'Night Ferry', genres: ['Drama', 'Sci-fi', 'Comedy', 'Thriller'], titles: ['Night Ferry', 'Paper City', 'Open Water', 'Red Horizon'] },
	Shows: { noun: 'shows', unit: 'episode watches', event: 'Episode watched', title: 'Harbor Lights', genres: ['Drama', 'Sci-fi', 'Comedy', 'Animation'], titles: ['Harbor Lights', 'Signal Moon', 'Small Hours', 'Paper Planets'] },
	Games: { noun: 'games', unit: 'recorded game plays', event: 'Played', title: 'Tidebound', genres: ['RPG', 'Strategy', 'Adventure', 'Puzzle'], titles: ['Tidebound', 'Orchard Quest', 'Paper Trails', 'Signal Runner'] },
	Music: { noun: 'albums', unit: 'recorded album listens', event: 'Listened', title: 'Low Tide', genres: ['Soul', 'Jazz', 'Electronic', 'Classical'], titles: ['Low Tide', 'Night Signals', 'Paper Skies', 'Open Season'] }
} satisfies Record<Exclude<ChartMedium, 'Benchmarks' | 'Screen'>, { noun: string; unit: string; event: string; title: string; genres: string[]; titles: string[] }>;

/** Independent media samples are new fictional datasets; no episode fixture is relabelled. */
function supplemental(fixture: ChartFixture, medium: ChartMedium): Raw | null {
	if (medium === 'Benchmarks' || medium === 'Screen' || nativeMedium(fixture) === medium) return null;
	const m = supplementalMedia[medium];
	const b = fixture.variant === 'B';
	const activity = medium === 'Games' ? (b ? [4, 6, 3, 8, 5, 7] : [2, 3, 5, 4, 6, 8])
		: medium === 'Music' ? (b ? [8, 6, 12, 10, 14, 16] : [6, 8, 5, 9, 12, 10])
		: medium === 'Shows' ? (b ? [16, 20, 18, 24, 22, 30] : [10, 14, 12, 18, 16, 20])
		: (b ? [8, 6, 10, 12, 9, 14] : [4, 6, 5, 8, 7, 10]);
	const count = medium === 'Games' ? [18, 12, 8, 6] : medium === 'Music' ? [24, 18, 12, 6] : medium === 'Shows' ? [32, 24, 16, 8] : [16, 12, 8, 4];
	const scores = medium === 'Music' ? [84, 74, null, 60] : medium === 'Games' ? [82, 90, 70, 66] : medium === 'Shows' ? [88, 80, 78, 72] : [80, 86, 76, 62];
	const style = fixture.sourceId;
	let period = '2026-04-01 through 2026-09-30';
	let periodLabel = 'Apr–Sep 2026';
	if (style === '4A' || style === '14B') {
		period = '2026-01-01 through 2026-12-31';
		periodLabel = 'Jan–Dec 2026 · complete fictional year';
	} else if (style === '4B' || style === '9A' || style === '9B') {
		period = '2026-09-01 through 2026-09-30';
		periodLabel = 'September 2026';
	} else if (style === '4C') {
		period = '2026-07-03 through 2026-09-30';
		periodLabel = '3 Jul–30 Sep 2026 · 90-day sample';
	} else if (fixture.context !== 'T' && ['2C', '5B', '6C'].includes(style)) {
		period = '2026-08-01 through 2026-09-30';
		periodLabel = 'Aug–Sep 2026';
	} else if (fixture.context !== 'T' && style === '6A') {
		period = '2025-09-01 through 2026-08-31 (historical reference); September 2026 (current)';
		periodLabel = 'Sep 2025–Aug 2026 reference · Sep 2026 highlighted';
	} else if (fixture.context !== 'T' && ['11A', '11B'].includes(style)) {
		period = '2026-01-01 through 2026-09-30';
		periodLabel = 'Jan–Sep 2026 · 2025 same-date reference';
	}
	const hasTemporalData = fixture.context !== 'T' || style === '8A' || style === '8B';
	const raw: Raw = {
		title: fixture.context === 'M' ? `${m.title} · ${m.noun} sample` : fixture.context === 'T' ? `You and Alex · ${m.noun} sample` : `Your ${m.noun} · fictional sample`,
		subtitle: `${medium} · Independent supplemental fictional dataset ${fixture.variant}${hasTemporalData ? ` · ${periodLabel} · UTC` : ''}`,
		...(hasTemporalData ? { period } : {}),
		unit: m.unit, supplemental: true, fictional: true,
		note: 'Independent local fictional media fixture. This sample is not a measurement or a relabelled source dataset. Recorded events do not imply playback duration.'
	};
	if (['1A', '1B'].includes(style)) return { ...raw, x: months, values: activity, legend: m.event };
	if (style === '2B' && fixture.context === 'T') return b
		? { ...raw, unit: `saved ${m.noun}`, x: m.genres, series: [{ name: 'Shared', values: [8, 6, 4, 2] }, { name: 'Only you', values: [4, 3, 2, 1] }, { name: 'Only Alex', values: [2, 4, 3, 1] }], note: 'Each primary-genre stack partitions the saved-set union into shared and two exclusive subsets. Distinct work IDs, one primary genre per work; category totals are additive.' }
		: { ...raw, unit: 'rating records', x: ['0.5–1.0', '1.5–2.0', '2.5–3.0', '3.5–4.0', '4.5–5.0'], series: [{ name: 'You', values: [1, 3, 6, 12, 8] }, { name: 'Alex', values: [2, 4, 8, 10, 6] }], note: 'Thirty rated works per profile on the native half-star scale. The stacks total60 rating records; profiles may rate the same work, so this is not60 unique titles.' };
	if (['1C', '2B'].includes(style)) return { ...raw, dates: months, x: months, series: [
		{ name: `First recorded ${medium === 'Games' ? 'plays' : medium === 'Music' ? 'listens' : 'watches'}`, values: activity },
		{ name: 'Repeat recorded events', values: b ? [1, 0, 2, 1, 3, 2] : [0, 1, 0, 2, 1, 3] }
	], note: 'Disjoint first and repeat recorded events. Each event belongs to exactly one series; sums count events, not unique works.' };
	if (style === '2A') return fixture.context === 'T'
		? { ...raw, title: `${medium} taste · four independent signals`, unit: '/100', rows: ['Genres', 'Ratings', 'Reactions', 'Interests'].map((label, index) => [label, scores[index]]), max: 100, evidence: [24, 12, medium === 'Music' ? 3 : 10, 18], note: 'Four independent agreement subscores. Reactions with only 3 shared pairs are unknown. Qualified evidence minimum is 5; weights ratings40/genres30/reactions20/interests10 only apply to an explicitly computed aggregate.' }
		: { ...raw, rows: m.genres.map((label, index) => [label, count[index]]) };
	if (style === '2C') return fixture.context === 'T'
		? { ...raw, title: `${medium} paired rating differences`, unit: 'stars', names: m.titles, values: b ? [1, -0.5, 0.5, -1] : [0.5, 1, -0.5, -1.5], max: 2, note: 'You minus Alex for four shared rated works. Every input is a native0.5–5 half-star rating; exact signed differences are half-star steps and are not agreement percentages.', positive: 'You rated higher', negative: 'Alex rated higher' }
		: { ...raw, names: m.genres, values: b ? [6, -4, 2, -2] : [4, 2, -3, 1], note: `September minus August recorded ${m.unit}. Signed event counts; zero is the unchanged baseline.`, positive: 'More recorded events', negative: 'Fewer recorded events' };
	if (['3A', '3B'].includes(style)) {
		if (fixture.context === 'T') return style === '3A'
			? b ? { ...raw, unit: 'reacted works', names: ['Same reaction', 'Different reaction', 'Only you', 'Only Alex'], values: [12, 8, 6, 4], note: 'Thirty works in the union of reacted sets. Twenty shared pairs include12 exact emoji matches and8 differences; reaction agreement is12/20=60%, not12/30.' }
				: { ...raw, unit: 'shared rated pairs', names: ['Same rating', '0.5 apart', '1 apart', '1.5+ apart'], values: [12, 8, 6, 4], note: 'Thirty shared rated work pairs, partitioned into disjoint native half-star difference bins. Composition is not a weighted taste score.' }
			: b ? { ...raw, unit: `saved ${m.noun}`, names: ['Shared', 'Only you', 'Only Alex'], values: [20, 12, 8], total: 40, note: 'Saved-set intersection20 / union40 means Jaccard50%. The plot depicts union composition; it does not depict weighting or a rating score.' }
				: { ...raw, unit: `shared ${m.noun}`, names: m.genres, values: count, total: sum(count), note: 'Shared saved works assigned one primary genre each. Counts partition the shared set; no genre score or weights are inferred.' };
		return { ...raw, names: m.genres, values: count, total: sum(count), note: 'One primary genre per recorded event. The categories are disjoint and additive; the total counts events, not unique people.' };
	}
	if (style === '3C') {
		if (fixture.context === 'T') return { ...raw, unit: '/100', rows: ['Genres', 'Ratings', 'Reactions', 'Interests'].map((label, index) => [label, scores[index], 100, '/100']), evidence: [24, 12, medium === 'Music' ? 3 : 10, 18], note: 'Independent agreement scores out of100. Missing reaction evidence stays unknown and contributes no filled arc. Scores are not parts of a total.' };
		return { ...raw, title: `Rated ${m.noun} in your consumed cohort`, unit: `rated ${m.noun}`, rows: m.titles.slice(0, 3).map((label, index) => [label, [8, 6, 4][index], [10, 8, 6][index], 'people']), note: `Fictional viewer/listener/player cohorts with a recorded consumption event. Each ring shows rated people within its explicit cohort; overlapping coverage is not additive and is not a goal.` };
	}
	if (style === '4A') return { ...raw, calendarYear: 2026, unit: m.unit, annualSupplement: true };
	if (style === '4B') return { ...raw, calendarYear: 2026, calendarMonth: 9, values: Array.from({ length: 30 }, (_, i) => i === 13 ? null : (i * 3 + (b ? 2 : 1)) % (medium === 'Shows' ? 7 : 5)), zeroMeaning: 'no recorded events', note: 'Exact supplemental September sample. 14 September has an unknown date count, displayed separately from days with zero recorded events.' };
	if (style === '4C') return { ...raw, matrix: weekdays.map((_, day) => Array.from({ length: 6 }, (_, hour) => day === 2 && hour === 1 ? null : (day * 3 + hour * 2 + (b ? 1 : 0)) % 13)), note: 'Known UTC event timestamps binned by weekday and four-hour block. Missing sample is null; zero means no recorded events. No duration is inferred.' };
	if (style === '5A') {
		const ratings = [2, 2.5, 3, 3.5, 4, 4.5, 5, 4];
		return fixture.context === 'T'
			? { ...raw, unit: 'stars', x: "Alex's rating", y: 'Your rating', domainX: [0.5, 5], domainY: [0.5, 5], points: ratings.map((rating, i) => [rating, Math.max(0.5, Math.min(5, rating + (i % 3 - 1) * 0.5))]), guide: 'Same rating', note: 'Eight shared rated works. Each native rating is0.5–5 in half-star steps; coordinates are exact and have no jitter.' }
			: { ...raw, unit: 'stars', x: m.unit, y: 'Your rating · /5', domainX: [0, 12], domainY: [0.5, 5], points: ratings.map((rating, i) => [i + 1, rating]), note: `Eight distinct ${m.noun}. X is recorded ${m.unit}; y is a native half-star rating. The axes have separate units and there is no diagonal agreement guide.` };
	}
	if (style === '5B') return fixture.context === 'T'
		? { ...raw, unit: '/100', axes: ['Genres', 'Ratings', 'Reactions', 'Interests'], series: [{ name: 'You + Alex', values: scores }, { name: 'You + Sam', values: [76, 84, 68, 58] }], max: 100, note: 'Independent agreement subscores; reactions with insufficient shared evidence stay unknown. An incomplete radar polygon must not imply zero or invent a composite score.' }
		: { ...raw, axes: m.genres, series: [{ name: 'August', values: count.map(v => Math.max(0, v - 2)) }, { name: 'September', values: count }], note: 'Genre frequencies may overlap. The spokes have one count domain and are not summed.' };
	if (style === '5C') return { ...raw, unit: `unique ${m.noun}`, left: fixture.context === 'T' ? 'You' : 'Saved', right: fixture.context === 'T' ? 'Alex' : 'Rated', a: b ? 30 : 24, b: b ? 24 : 18, shared: b ? 12 : 10, note: `Distinct ${m.noun} IDs define ${fixture.context === 'T' ? 'the two saved-interest sets' : 'saved and rated sets'}. The union subtracts the shared count once; this set overlap is not a rating agreement score.` };
	if (style === '6A') return fixture.context === 'T'
		? b ? { ...raw, unit: '/100', min: 20, q1: 50, median: 65, q3: 80, max: 100, current: medium === 'Music' ? null : scores[2], currentLabel: 'You + Alex', axisMax: 100, note: `Thirty qualified reaction-agreement profile pairs with at least5 shared pairs each. ${medium === 'Music' ? 'Current Music pair has only3 shared reactions and is unknown; it is not plotted at zero.' : 'Current pair is a separate qualified observation.'}` }
			: { ...raw, unit: 'stars', min: 0.5, q1: 2, median: 3.5, q3: 4.5, max: 5, current: 4, currentLabel: m.title, axisMin: 0.5, axisMax: 5, note: 'Your native half-star ratings for30 shared rated works; this distribution is not the rating-agreement score. One selected work has rating4/5.' }
		: { ...raw, unit: m.unit, min: 0, q1: 2, median: 4, q3: 6, max: 10, current: b ? 8 : 7, currentLabel: 'September', axisMax: 12, note: 'Explicit distribution of earlier monthly recorded event counts. September is a separate current observation; no arbitrary target.' };
	if (style === '6B') return { ...raw, dates: months, unit: `${m.unit} / day`, median: [1, 2, 2, 3, 2, 4], q1: [0, 1, 1, 2, 1, 3], q3: [2, 3, 3, 4, 3, 5], max: 6, note: 'Daily recorded event counts including known zero-event days, summarized by month. Undated events excluded. IQR is not uncertainty about a monthly total.' };
	if (style === '6C') return fixture.context === 'T'
		? { ...raw, unit: 'stars', names: m.titles.slice(0, 3), before: [4.5, 3.5, 4], after: [4, 4.5, 3.5], left: 'You', right: 'Alex', min: 0.5, max: 5, note: 'Three selected shared works with exact native half-star ratings. Comparing these observations does not establish an overall qualified agreement score.' }
		: { ...raw, names: m.genres.slice(0, 3), before: count.slice(0, 3).map(v => v - 2), after: count.slice(0, 3), left: 'August', right: 'September', note: 'Two monthly snapshots of genre event counts. Genres may overlap; counts across genres are not additive.' };
	if (style === '7A') return fixture.context === 'T'
		? b ? { ...raw, unit: 'qualified pairs', bins: ['0–19', '20–39', '40–59', '60–79', '80–100'], counts: [2, 4, 8, 14, 12], xunit: 'Reaction agreement · /100', yunit: 'Qualified profile pairs', note: 'Forty qualified pairs each with at least5 shared emoji-reaction observations. Unknown pairs are excluded rather than assigned score0. Final bin includes100.' }
			: { ...raw, unit: 'shared pairs', bins: ['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5'], counts: [12, 10, 8, 4, 3, 1, 1, 1, 0, 0], xunit: 'Absolute native rating difference · stars', yunit: 'Shared rated works', note: 'Forty paired native half-star ratings. The maximum possible gap is4.5; bin0 is an exact match and is not missing evidence.' }
		: { ...raw, unit: `unique ${m.noun}`, bins: ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'], counts: b ? [1, 2, 3, 5, 7, 8, 10, 14, 8, 2] : [0, 1, 2, 3, 4, 6, 10, 12, 8, 4], xunit: 'Your native rating · /5', yunit: `Unique rated ${m.noun}`, note: 'Exact count at each native half-star rating. Each distinct rated work appears once; missing ratings are excluded rather than counted as zero.' };
	if (style === '7B') return { ...raw, unit: 'Rating · /5', x: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], domain: [0.5, 5], series: [{ name: 'You', counts: [0, 1, 2, 3, 4, 6, 10, 12, 8, 4], median: 3.5 }, { name: 'Alex', counts: [1, 2, 3, 5, 7, 8, 10, 8, 4, 2], median: 3 }], note: 'Exact half-star frequency samples. The preview applies illustrative frequency-weighted smoothing bounded by the native 0.5–5 domain; it does not generate new observed ratings.' };
	if (['8A', '8B'].includes(style)) {
		if (fixture.context === 'T') return style === '8A'
			? { ...raw, unit: '/100', cols: ['Signal', 'Agreement', 'Six snapshots', 'Evidence'], rows: ['Genres', 'Ratings', 'Reactions', 'Interests'].map((label, i) => [label, scores[i], scores[i] === null ? [null, null, null, null, null, null] : [scores[i]! - 12, scores[i]! - 10, scores[i]! - 6, scores[i]! - 4, scores[i]! - 2, scores[i]], i === 2 && medium === 'Music' ? '3 shared pairs · insufficient' : `${[24, 12, 10, 18][i]} relevant observations`]), note: 'Six independent fictional qualified-score snapshots on a common0–100 domain. Insufficient reaction evidence is null for every snapshot. Scores do not sum to a whole.' }
			: { ...raw, unit: 'stars', cols: ['Work', 'You / Alex', 'Your rating snapshots', 'Absolute gap'], rows: m.titles.map((label, i) => [label, `${[4.5, 4, 3.5, 3][i]} / ${[4, 4, 4, 3.5][i]}`, [[3, 3.5, 3.5, 4, 4, 4.5], [2.5, 3, 3, 3.5, 3.5, 4], [2, 2.5, 3, 3, 3.5, 3.5], [2, 2, 2.5, 2.5, 3, 3]][i], [0.5, 0, 0.5, 0.5][i]]), note: 'Four selected paired ratings and six fictional rating-edit snapshots, all on the native half-star scale. The last snapshot equals the current rating; no overall agreement is inferred from a partial selection.' };
		return { ...raw, cols: ['Work', 'Recorded events', 'Apr–Sep activity', 'Total scope'], rows: m.titles.map((label, i) => { const values = activity.map(v => Math.max(0, v - i * 2)); return [label, sum(values), values, 'Six shown months']; }), note: `Distinct ${m.noun} rows. Each total is the exact sum of its six monthly recorded event counts; sparklines share one numeric domain.` };
	}
	if (['9A', '9B'].includes(style)) return { ...raw, unit: 'Journal events', events: [
		{ day: 3, label: m.title, detail: 'Saved', state: 'saved' },
		{ day: 10, label: m.title, detail: m.event, state: medium === 'Games' ? 'played' : medium === 'Music' ? 'listened' : 'watched' },
		{ day: 17, label: m.title, detail: 'Rated4.0/5', state: 'rated' },
		{ day: 26, label: m.title, detail: `Repeat ${m.event.toLowerCase()}`, state: medium === 'Games' ? 'played' : medium === 'Music' ? 'listened' : 'watched' }
	], note: 'Exact known UTC journal dates in September2026. The horizontal axis is date; vertical placement is only for labels. Rating updates do not count as recorded consumption.' };
	if (style === '10A') return { ...raw, unit: fixture.context === 'T' ? `shared saved ${m.noun}` : `saved ${m.noun}`, values: Object.fromEntries(m.genres.map((label, i) => [label, count[i]])), total: sum(count), note: 'One primary genre per distinct work in this saved cohort; exact rectangular areas derive from counts.' };
	if (style === '10B') return { ...raw, unit: `distinct saved ${m.noun}`, groups: { Shared: { [m.genres[0]]: 12, [m.genres[1]]: 8 }, 'Only you': { [m.genres[0]]: 6, [m.genres[1]]: 4 }, 'Only Alex': { [m.genres[0]]: 8, [m.genres[1]]: 2 } }, total: 40, intersection: 20, union: 40, note: 'Saved-set union partitioned into three disjoint groups and one primary genre per work. Shared count20/union40 gives Jaccard50%; area shows counts.' };
	if (['11A', '11B'].includes(style)) return fixture.context === 'T'
		? { ...raw, title: `${medium} rating agreement`, unit: '/100', value: 80, benchmark: 60, comparison: 60, max: 100, sharedRatings: 10, meanAbsoluteDifference: 0.9, ratingScale: [0.5, 5], note: 'Ten shared native ratings. Agreement=100×(1−0.9/4.5)=80. The reference60 is an explicitly fictional earlier qualified pair score, not a viewing target.' }
		: { ...raw, title: `Unique ${m.noun} rated this year`, unit: `unique rated ${m.noun}`, value: medium === 'Music' ? 30 : medium === 'Games' ? 18 : 24, benchmark: 12, comparison: 12, max: 40, comparisonPeriod: '2025-01-01 through 2025-09-30', note: 'Current and previous-year same-date observed fictional counts. Axis ceiling is a scale limit, not a capacity or goal.' };
	if (['12A', '12B'].includes(style)) return { ...raw, unit: `distinct saved ${m.noun} IDs`, cohort: 60, stages: medium === 'Music' ? { Saved: 60, 'Fully listened': 36, 'Listened again': 24 } : { Saved: 60, Started: 36, Completed: 24 }, note: 'A declared cohort of60 distinct saved works. Every downstream stage is a nested subset; stage totals must not be added. Album completion uses a known-track traversal.' };
	if (style.startsWith('13')) return fixture.context === 'T'
		? { ...raw, title: `${medium} taste · independent scores`, unit: '/100', values: ['Genres', 'Ratings', 'Reactions', 'Interests'].map((signal, i) => ({ signal, score: scores[i], medium: medium.toLowerCase(), evidence: i === 2 && medium === 'Music' ? 3 : [24, 12, 10, 18][i] })), note: 'Four independent qualified agreement scores. Bubble area encodes each score; unknown reactions with only3 pairs have no data area. No composite score or invented weights.' }
		: { ...raw, unit: `distinct saved ${m.noun}`, values: m.genres.map((label, i) => ({ label, value: count[i], medium: medium.toLowerCase() })), total: sum(count), note: 'One primary genre per unique saved work. Bubble area is proportional to count; radius is its square root.' };
	if (style === '14A') return { ...raw, unit: `unique saved ${m.noun}`, flows: [['Saved', 'Started', 36], ['Saved', 'Not started', 24], ['Started', 'Completed', 24], ['Started', 'In progress', 12], ['Not started', 'Still saved', 24]], total: 60, note: 'A fixed60-work cohort. Flow counts conserve each intermediate node; saved and completion states are local fictional history, never inferred production fields.' };
	if (style === '14B') { const values = [2, 4, 3, 5, 6, 4, 8, 7, 6, 9, 5, 4]; return { ...raw, year: 2026, values, total: sum(values), note: 'Twelve exact recorded event counts in a complete fictional2026 sample; angle encodes month and radius is proportional to event count. Undated events are excluded.' }; }
	if (style === '14C') return fixture.context === 'T'
		? { ...raw, unit: '/100', symbolUnit: 10, values: [{ label: 'Genres', value: 80, evidence: 12 }, { label: 'Ratings', value: 80, evidence: 10, meanAbsoluteDifference: 0.9 }, { label: 'Reactions', value: 70, evidence: 10 }, { label: 'Interests', value: 60, evidence: 18 }], note: 'One symbol equals10 agreement points. Exact symbols8,8,7,6, with no inactive capacity; signals remain independent.' }
		: { ...raw, unit: `unique saved ${m.noun}`, symbolUnit: 1, values: m.genres.map((label, i) => ({ label, value: [8, 6, 4, 2][i], medium: medium.toLowerCase() })), total: 20, note: 'One symbol equals one distinct saved work. Exact counts8+6+4+2=20; no invented grey capacity.' };
	return null;
}

/** Exact declared supplemental sample; the annual raster only specifies qualitative patterns. */
function annualValues(fixture: ChartFixture, raw: Raw): (number | null)[] {
	const year = numeric(raw.calendarYear, 2026);
	const length = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
	return Array.from({ length }, (_, index) => {
		const date = new Date(Date.UTC(year, 0, index + 1));
		const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
		const month = date.getUTCMonth();
		if (fixture.context === 'P' && fixture.variant === 'A') return index % 17 === 0 ? null : [175, 125, 75, 50][Math.floor(month / 3)] + (index % 3 - 1) * 10;
		if (fixture.context === 'P') return weekend ? 0 : month === 8 ? 15 + index % 6 : 5 + index % 6;
		if (fixture.context === 'M') return fixture.variant === 'A' ? (month < 5 ? (index % 9 === 0 ? 5 : 0) : month === 8 ? 15 + index % 6 : 5 + index % 6) : ([4, 5, 8].includes(month) ? 30 : 10) + index % 11;
		return index % 53 === 0 ? null : weekend ? 2 + index % 3 : index % 2;
	});
}

function evidenceDetail(raw: Raw): string {
	if (typeof raw.evidence === 'number') return `${raw.evidence} evidence observations${raw.evidence < 5 ? ' · insufficient (minimum5)' : ''}`;
	if (raw.evidence && typeof raw.evidence === 'object') {
		const evidence = record(raw.evidence);
		return `Eligible titles: you ${numeric(evidence.you)}, Alex ${numeric(evidence.alex)}`;
	}
	if (raw.sharedPairs !== undefined) return `${numeric(raw.identicalEmojiPairs)} exact emoji matches / ${numeric(raw.sharedPairs)} shared pairs`;
	if (raw.intersection !== undefined) return `${numeric(raw.intersection)} intersection / ${numeric(raw.union)} union`;
	if (raw.sharedRatings !== undefined) return `${numeric(raw.sharedRatings)} shared native rating pairs`;
	return '';
}

function axisUnit(label: string): string {
	if (/MiB/.test(label)) return 'MiB';
	if (/\bms\b/.test(label)) return 'ms';
	if (/rating/i.test(label)) return 'stars';
	if (/year/i.test(label)) return 'year';
	if (/viewers/i.test(label)) return 'viewers';
	if (/view/i.test(label)) return 'views';
	if (/watch/i.test(label)) return 'watches';
	if (/titles/i.test(label)) return 'titles';
	return label;
}

function objectRow(value: unknown, index: number): ChartRow {
	const raw = record(value);
	const mediumLabel = ({ screen: 'Screen', game: 'Games', games: 'Games', music: 'Music', movies: 'Movies', shows: 'Shows' } as Record<string, string>)[string(raw.medium)];
	const label = string(raw.label, string(raw.signal, raw.rating !== undefined ? `${raw.rating} /5` : `Value ${index + 1}`));
	const fullLabel = raw.signal && mediumLabel ? `${mediumLabel} · ${label}` : label;
	const valueKey = 'score' in raw ? 'score' : 'value' in raw ? 'value' : 'completed';
	const detail = evidenceDetail(raw);
	return { label: fullLabel, value: number(raw[valueKey]), reference: number(raw.previous) ?? undefined, capacity: number(raw.available) ?? undefined,
		medium: string(raw.medium) || (/^(Screen|Games|Music)/.exec(label)?.[1]), evidence: number(raw.evidence) ?? number(raw.sharedPairs) ?? number(raw.sharedRatings) ?? undefined, detail: detail || undefined };
}

const referenceLabels: Record<string, string> = {
	'11A-PA': 'Previous median', '11A-PB': 'Previous sampled process-memory peak',
	'11A-TA': 'Friend-pair median ·30 qualified pairs', '11A-TB': 'Friend-pair median ·30 qualified pairs',
	'11A-SA': '2025 same date', '11A-SB': '2025 same date', '11A-MA': 'Cohort mean ·200 ratings', '11A-MB': 'Known eligible episodes',
	'11B-PA': 'Previous median', '11B-PB': 'Previous sampled process-memory peak',
	'11B-TA': 'Friend-pair median', '11B-TB': 'Friend-pair median',
	'11B-SA': '2025 same date', '11B-SB': '2025 same date', '11B-MA': 'Cohort mean ·200 ratings', '11B-MB': 'Cohort median ·50 viewers'
};
const tableDomains: Record<string, [number, number]> = {
	'8A-PA': [0, 200], '8A-PB': [0, 120], '8A-TA': [0, 100], '8A-TB': [0, 100],
	'8A-SA': [0, 40], '8A-SB': [0, 30], '8A-MA': [0, 80], '8A-MB': [0, 100],
	'8B-PA': [0, 200], '8B-PB': [0, 120], '8B-TA': [0.5, 5], '8B-TB': [0, 100],
	'8B-SA': [0, 5], '8B-SB': [0, 8], '8B-MA': [0, 16], '8B-MB': [0, 20]
};

function normalize(fixture: ChartFixture, medium: ChartMedium): ChartModel {
	const replacement = supplemental(fixture, medium);
	let raw = replacement ?? fixture.semanticData;
	const style = fixture.sourceId;
	if (referenceLabels[fixture.id]) raw = { ...raw, referenceLabel: replacement ? (fixture.context === 'T' ? 'Earlier qualified pair score' : '2025 same date') : referenceLabels[fixture.id] };
	if (fixture.id === '2C-PB') raw = { ...raw, lowerIsBetter: true };
	if (fixture.id === '9B-MB' && !replacement) raw = { ...raw, asOf: '2026-09-22' };
	const model: ChartModel = {
		fixtureId: fixture.id, styleId: style, title: string(raw.title, fixture.title),
		subtitle: string(raw.subtitle, string(raw.caption, string(raw.sub, string((fixture as ChartFixture & { caption?: string }).caption, `${medium} · Exact local fictional fixture ${fixture.id}`)))),
		unit: string(raw.unit, string(raw.units)), notes: [], labels: [], rows: [], series: [], points: [], events: [], flows: [], matrix: [],
		domain: [0, 1], domainY: [0, 1], ticks: [], ticksY: [], xLabel: '', yLabel: '', raw
	};
	if (!replacement && style === '14B') model.subtitle += ` · Jan–Dec ${numeric(raw.year, 2026)} · complete fictional year · UTC`;
	if (!replacement && style === '4B' && !model.subtitle.includes('2026')) model.subtitle += ' · September 2026 · UTC';
	for (const key of ['note', 'scope', 'extra', 'assignment', 'comparison']) {
		if (typeof raw[key] === 'string') model.notes.push(raw[key] as string);
	}
	if (raw.period) model.notes.push(`Period: ${raw.period}`);
	if (raw.asOf) model.notes.push(`As of ${raw.asOf}`);
	for (const key of ['undatedExcluded', 'excludedUndated', 'replaysExcluded', 'uniqueTitles', 'rewatches', 'replayEvents']) {
		if (number(raw[key]) !== null) model.notes.push(`${key.replace(/([A-Z])/g, ' $1')}: ${raw[key]}`);
	}
	if (fixture.context === 'P') model.notes.push('Comparable fictional workloads only. These are not measured app performance results.');
	if (fixture.context === 'T') model.notes.push('Ratings40% · Genres30% · Reactions20% · Interests10%; renormalize only qualified signals if computing an aggregate. Independent scores are not additive.');
	if (/^[149][A-C]$/.test(style) || style === '6B' || style === '14B') model.notes.push('Dated local fixture events use UTC; unknown event dates are excluded. Period and date membership are explicit fictional sample metadata.');
	if (replacement) model.notes.push('Supplemental fictional media sample; source variant values remain preserved in the catalog.');
	model.total = number(raw.total) ?? number(raw.totalCompleted) ?? undefined;
	model.symbolUnit = number(raw.symbolUnit) ?? undefined;

	if (style === '4A' || style === '4B') {
		const year = numeric(raw.calendarYear, 2026);
		const month = style === '4A' ? 0 : numeric(raw.calendarMonth, 9);
		const values = style === '4A' ? annualValues(fixture, raw) : numbers(raw.values).map(value => fixture.id === '4B-PA' && !replacement && value === 0 ? null : value);
		model.calendar = { year, month, values };
		model.rows = values.map((value, index) => ({ label: new Date(Date.UTC(year, month === 0 ? 0 : month - 1, index + 1)).toISOString().slice(0, 10), value, detail: value === null ? (fixture.context === 'P' ? 'No qualified samples' : 'Unknown event count') : value === 0 ? 'Known zero recorded events' : undefined }));
		model.labels = model.rows.map(row => row.label);
		if (style === '4A') {
			model.raw = { ...raw, annualSupplement: true };
			model.notes.push('The annual source supplies a qualitative pattern, not 365 daily values. This deterministic supplemental fictional sample is declared explicitly; no raster values were inferred.');
		}
		if (fixture.id === '4B-PB') model.notes.push('Source metadata says “no samples” for zero, but the explicit completed-run note defines these days as zero completed runs; zero is retained.');
	} else if (style === '4C') {
		model.matrix = array(raw.matrix).map(numbers);
		model.labels = ['00', '04', '08', '12', '16', '20'];
		model.rows = model.matrix.flatMap((values, day) => values.map((value, hour) => ({ label: `${weekdays[day]} · ${model.labels[hour]}:00 UTC`, value })));
		model.xLabel = 'UTC hour'; model.yLabel = 'Weekday';
	} else if (style === '5A') {
		const selected = numeric(raw.selected, -1);
		model.points = array(raw.points).map((point, index) => {
			const pair = array(point);
			return { label: index === selected ? string(raw.label, `Observation ${index + 1}`) : `Observation ${index + 1}`, x: numeric(pair[0]), y: numeric(pair[1]), detail: `${string(raw.x)}: ${pair[0]} · ${string(raw.y)}: ${pair[1]}` };
		});
		model.rows = model.points.map(point => ({ label: point.label, value: point.y, reference: point.x, detail: point.detail, valueUnit: axisUnit(string(raw.y)), referenceUnit: axisUnit(string(raw.x)) }));
		model.domain = numbers(raw.domainX) as [number, number]; model.domainY = numbers(raw.domainY) as [number, number];
		model.ticks = parseTicks(raw.ticksX); model.ticksY = parseTicks(raw.ticksY);
		model.xLabel = string(raw.x); model.yLabel = string(raw.y);
	} else if (style === '5C') {
		const a = numeric(raw.a), b = numeric(raw.b), shared = numeric(raw.shared);
		model.rows = [{ label: `Only ${raw.left}`, value: a - shared }, { label: 'Both', value: shared }, { label: `Only ${raw.right}`, value: b - shared }];
		model.total = a + b - shared;
	} else if (style === '6A') {
		model.interval = { min: numeric(raw.min), q1: numeric(raw.q1), median: numeric(raw.median), q3: numeric(raw.q3), max: numeric(raw.max), current: number(raw.current) ?? undefined };
		model.rows = ['min', 'q1', 'median', 'q3', 'max', 'current'].filter(key => number(raw[key]) !== null).map(key => ({ label: key === 'current' ? string(raw.currentLabel, 'Current') : ({ min: 'Minimum', q1: 'Q1', median: 'Median', q3: 'Q3', max: 'Maximum' } as Record<string, string>)[key], value: number(raw[key]) }));
	} else if (style === '6C') {
		model.labels = strings(raw.names);
		model.series = [{ name: string(raw.left, 'Before'), values: numbers(raw.before) }, { name: string(raw.right, 'After'), values: numbers(raw.after) }];
		model.rows = model.labels.map((label, index) => ({ label, value: number(model.series[1].values[index]), reference: number(model.series[0].values[index]) ?? undefined, values: model.series.map(series => series.values[index] ?? null) }));
	} else if (style === '7A') {
		model.labels = strings(raw.bins);
		model.rows = model.labels.map((label, index) => ({ label, value: number(array(raw.counts)[index]) }));
		model.xLabel = string(raw.xunit); model.yLabel = string(raw.yunit); model.unit = string(raw.yunit, model.unit); model.total = sum(model.rows.map(row => row.value));
	} else if (style === '9A' || style === '9B') {
		model.events = array(raw.events).map(event => { const e = record(event); const day = numeric(e.day); return { label: string(e.label), day, detail: string(e.detail), state: string(e.state, string(e.colour)), date: `2026-09-${String(day).padStart(2, '0')}` }; });
		model.rows = model.events.map(event => ({ label: event.label, value: event.day, valueUnit: 'September day', detail: `${event.date} · ${event.detail}` }));
		model.domain = [1, 30]; model.xLabel = 'September2026 · UTC date';
	} else if (style === '14A') {
		// Source labels sometimes carry node totals (“Started60”); those aliases name one conserved node.
		const node = (value: unknown) => {
			const label = String(value);
			if (/^Saved\d+$/.test(label)) return 'Saved cohort';
			return label.replace(/(?<=[A-Za-z ])\d+$/, '').trim();
		};
		model.flows = array(raw.flows).map(flow => { const f = array(flow); return { source: node(f[0]), target: node(f[1]), value: numeric(f[2]) }; });
		model.rows = model.flows.map(flow => ({ label: `${flow.source} → ${flow.target}`, value: flow.value }));
	} else if (style === '14B') {
		model.labels = monthLabels;
		model.rows = monthLabels.map((label, index) => ({ label, value: number(array(raw.values)[index]) }));
	} else if (style === '11A' || style === '11B') {
		model.rows = [{ label: model.title, value: number(raw.value), reference: number(raw.benchmark) ?? number(raw.previous) ?? number(raw.comparison) ?? undefined, capacity: !replacement && fixture.id === '11A-MB' ? 62 : number(raw.eligible) ?? undefined,
			detail: `Reference: ${raw.referenceLabel}${raw.lowerIsBetter ? ' · Lower is better' : ''}` }];
		if (!replacement && fixture.id === '11A-MA') raw = model.raw = { ...raw, min: 0.5 };
		if (fixture.context === 'P' && fixture.variant === 'B') model.notes.push('Metric is maximum sampled whole-process RSS in MiB; it is separate from isolated JavaScript heap allocation.');
	} else if (style === '12A' || style === '12B') {
		model.rows = Object.entries(record(raw.stages)).map(([label, value]) => ({ label, value: number(value), capacity: number(raw.cohort) ?? undefined }));
		model.total = model.rows[0]?.value ?? undefined;
		model.notes.push(`Declared cohort: ${raw.cohort}. Stages are nested, not disjoint parts of a total.`);
	} else if (raw.groups) {
		model.rows = Object.entries(record(raw.groups)).flatMap(([group, values]) => Object.entries(record(values)).map(([label, value]) => ({ label, group, value: number(value), medium: /Movies|Shows|Watching/.test(group) ? 'Screen' : /Playing/.test(group) ? 'Games' : /Listening/.test(group) ? 'Music' : undefined })));
	} else if (raw.series || raw.av || (style === '6B' && raw.median)) {
		model.labels = strings(raw.axes ?? raw.dates ?? raw.x);
		model.series = raw.series ? array(raw.series).map(value => { const series = record(value); return { name: string(series.name), values: numbers(series.values ?? series.counts) }; })
			: style === '6B' ? [{ name: 'Median', values: numbers(raw.median) }, { name: 'Q1', values: numbers(raw.q1) }, { name: 'Q3', values: numbers(raw.q3) }]
				: ['a', 'b', 'c'].filter(key => raw[`${key}v`]).map(key => ({ name: string(raw[key]), values: numbers(raw[`${key}v`]) }));
		model.rows = model.labels.map((label, index) => ({ label, value: model.series[0]?.values[index] ?? null, values: model.series.map(series => series.values[index] ?? null) }));
		if (style === '7B') {
			model.domain = numbers(raw.domain) as [number, number];
			model.domainY = extent(model.series.flatMap(series => series.values));
			model.xLabel = model.unit; model.yLabel = 'Sample frequency';
		}
	} else if (raw.rows) {
		model.rows = array(raw.rows).map(value => {
			const row = array(value); const pair = typeof row[1] === 'string' ? row[1].split('/').map(parseFloat) : [];
			const primary = number(row[1]) ?? (typeof row[1] === 'string' && Number.isFinite(parseFloat(row[1])) ? parseFloat(row[1]) : null);
			return { label: String(row[0]), value: primary,
				capacity: style === '3C' ? number(row[2]) ?? undefined : undefined,
				reference: pair.length === 2 && Number.isFinite(pair[1]) ? pair[1] : undefined,
				values: Array.isArray(row[2]) ? numbers(row[2]) : undefined,
				detail: style.startsWith('8') ? `${row[1]} · ${row[3]}` : undefined };
		});
		if (style === '3C') {
			model.unit = string(array(array(raw.rows)[0])[3], model.unit);
			if (model.unit === 'score') model.unit = '/100';
		}
	} else if (Array.isArray(raw.values)) {
		if (raw.values.length && typeof raw.values[0] === 'object') model.rows = raw.values.map(objectRow);
		else {
			model.labels = strings(raw.names ?? raw.x ?? raw.dates);
			model.rows = numbers(raw.values).map((value, index) => ({ label: model.labels[index] ?? `Value ${index + 1}`, value }));
			if (style === '1A' || style === '1B') model.series = [{ name: string(raw.legend, 'Recorded values'), values: numbers(raw.values) }];
		}
	} else if (raw.values && typeof raw.values === 'object') {
		model.rows = Object.entries(record(raw.values)).map(([label, value]) => ({ label, value: number(value), medium: /Watching/.test(label) ? 'Screen' : /Playing/.test(label) ? 'Games' : /Listening/.test(label) ? 'Music' : undefined }));
	}
	if (fixture.id === '2C-MA' && !replacement) {
		model.rows[4].label = 'Earlier viewer cohort';
		model.notes.push('The source “All-time viewers” label is ambiguous against its overall mean. This row is explicitly a separate fictional earlier cohort with mean3.0/5.');
	}
	if (fixture.context === 'T' && /agreement|score|percent|cosine|Jaccard/i.test(model.unit)) model.unit = '/100';
	if (fixture.context === 'T') {
		model.rows.forEach((row, index) => {
			const evidence = number(array(raw.evidence)[index]);
			if (evidence !== null) {
				row.evidence = evidence;
				row.detail = `${evidence} evidence observations${evidence < 5 ? ' · insufficient (minimum5)' : ''}`;
			}
			if (fixture.id === '2A-TB') {
				if (row.label === 'Ratings') { row.evidence = 28; row.detail = '28 shared native half-star rating pairs'; }
				if (row.label === 'Reactions') { row.evidence = 34; row.detail = '34 shared emoji-reaction pairs'; }
			}
		});
	}
	if (model.labels.length === 0) model.labels = model.rows.map(row => row.label);
	const all = [...model.rows.flatMap(row => [row.value, row.reference ?? null, ...(row.values ?? [])]), ...model.matrix.flat(), ...model.series.flatMap(series => series.values)];
	if (style !== '5A' && style !== '7B' && !style.startsWith('9')) {
		model.ticks = parseTicks(raw.ticks ?? raw.yticks);
		const stacked = style === '1C' || style === '2B';
		const maxObserved = Math.max(1, ...(stacked ? model.rows.map(row => sum(row.values ?? [row.value])) : all.filter((v): v is number => v !== null)));
		const min = number(raw.axisMin) ?? (style === '2C' ? -Math.max(numeric(raw.max), maxObserved) : (style === '6C' || style.startsWith('11')) && number(raw.min) !== null ? numeric(raw.min) : 0);
		const max = number(raw.axisMax) ?? number(raw.max) ?? Math.max(maxObserved, ...model.ticks);
		model.domain = [Math.min(min, ...model.ticks), Math.max(max, maxObserved)];
		model.domainY = model.domain;
	}
	if (style.startsWith('8')) {
		model.domain = replacement ? extent(model.rows.flatMap(row => row.values ?? [])) : tableDomains[fixture.id];
		model.domainY = model.domain;
		model.ticks = [];
	}
	if (model.ticks.length === 0) model.ticks = makeTicks(model.domain);
	if (model.ticksY.length === 0) model.ticksY = style === '7B' ? makeTicks(model.domainY) : model.ticks;
	if (!model.yLabel) model.yLabel = model.unit;
	if (['3A', '3B', '10A', '10B'].includes(style) && model.total === undefined) model.total = sum(model.rows.map(row => row.value));
	return model;
}

export function getChartModel(fixture: ChartFixture, medium: ChartMedium): ChartModel {
	if (!supportedMediums(fixture).includes(medium)) throw new Error(`Unsupported medium ${medium} for ${fixture.id}`);
	const key = `${fixture.id}:${medium}`;
	let model = cache.get(key);
	if (!model) { model = normalize(fixture, medium); cache.set(key, model); }
	return model;
}

/** Selectable mark indices and detail-table rows have the same order in every renderer. */
export function dataRows(model: ChartModel): ChartRow[] { return model.rows; }

const sourceDatasetNames: Record<string, Partial<Record<ChartContext, [string, string]>>> = {
	'1A': { P: ['Median latency', 'Tail latency'], S: ['Movie watches', 'Unique episodes'], M: ['Quiet Harbour', 'Signal Moon'] },
	'1B': { P: ['Median latency', 'Tail latency'], S: ['Movie watches', 'Unique episodes'], M: ['Quiet Harbour', 'Signal Moon'] },
	'1C': { P: ['Probe durations', 'CPU time'], S: ['Recorded watches', 'Unique titles'], M: ['Quiet Harbour', 'Signal Moon'] },
	'2A': { P: ['Median latency', 'Tail latency'], T: ['Shared genres', 'Taste signals'], S: ['Watch genres', 'Replayed movies'], M: ['Movie reactions', 'Episode views'] },
	'2B': { P: ['Probe durations', 'CPU time'], T: ['Rating distributions', 'Saved interests'], S: ['Recorded watches', 'First watched titles'], M: ['Movie views', 'Episode views'] },
	'2C': { P: ['Latency change', 'Memory change'], T: ['Rating differences', 'Interest balance'], S: ['Watch changes', 'New episode changes'], M: ['Cohort ratings', 'Episode view changes'] },
	'3A': { P: ['Batch durations', 'Run outcomes'], T: ['Rating gaps', 'Reaction overlap'], S: ['Watch formats', 'Rated genres'], M: ['Movie reactions', 'Season views'] },
	'3B': { P: ['Batch durations', 'Latency bins'], T: ['Shared genres', 'Saved interests'], S: ['Release decades', 'Rating distribution'], M: ['Movie ratings', 'Season views'] },
	'3C': { P: ['Budget use', 'Samples within budget'], T: ['Taste signals', 'Exact matches'], S: ['Episode coverage', 'Rated title coverage'], M: ['Viewer coverage', 'Season coverage'] },
	'4A': { P: ['Daily latency', 'Completed runs'], S: ['Recorded watches', 'First watched episodes'], M: ['Movie views', 'Episode views'] },
	'4B': { P: ['Daily latency', 'Completed runs'], S: ['Recorded watches', 'First watched episodes'], M: ['Movie views', 'Episode views'] },
	'4C': { P: ['Median latency', 'Run starts'], S: ['Recorded watches', 'First episode watches'], M: ['Movie views', 'Episode views'] },
	'5A': { P: ['Latency comparison', 'Heap comparison'], T: ['Paired ratings', 'Genre frequencies'], S: ['Ratings and repeats', 'Ratings by release year'], M: ['Views and viewers', 'Episode views and ratings'] },
	'5B': { P: ['Probe latency', 'Probe heap'], T: ['Across media', 'Across connections'], S: ['Watch genres', 'Saved genres'], M: ['Viewer cohort ratings', 'Episode cohort ratings'] },
	'5C': { T: ['Shared favourites', 'Saved interests'], S: ['Watched and rated', 'Saved and consumed'], M: ['Ratings and reactions', 'Returning viewers'] },
	'6A': { P: ['Latency distribution', 'Heap distribution'], T: ['Shared title ratings', 'Reaction agreement'], S: ['Monthly watches', 'Monthly unique episodes'], M: ['Viewer ratings', 'Episode view counts'] },
	'6B': { P: ['Latency history', 'Heap history'], S: ['Daily watches', 'Daily unique episodes'], M: ['Daily movie views', 'Daily episode views'] },
	'6C': { P: ['Latency change', 'Heap change'], T: ['Shared favourites', 'Taste connections'], S: ['Genre watches', 'Unique titles'], M: ['Reaction changes', 'Episode view changes'] },
	'7A': { P: ['Latency distribution', 'Heap distribution'], T: ['Rating gaps', 'Reaction agreement'], S: ['Movie repeats', 'Daily unique episodes'], M: ['Viewer ratings', 'Episode reach'] },
	'7B': { P: ['Latency distributions', 'Heap distributions'], T: ['Paired rating distributions', 'Saved interest agreement'], S: ['Daily watches', 'Daily unique episodes'], M: ['Viewer cohort ratings', 'Episode reach'] },
	'8A': { P: ['Latency by probe', 'Heap by probe'], T: ['Taste signal history', 'Shared interests'], S: ['Revisited movies', 'Show activity'], M: ['Viewer cohorts', 'Episode momentum'] },
	'8B': { P: ['Latency by probe', 'Heap by probe'], T: ['Paired movie ratings', 'Show taste signals'], S: ['Replayed movies', 'Unique show episodes'], M: ['Weekly movie views', 'Episode activity'] },
	'9A': { P: ['Latency runs', 'Heap runs'], S: ['Movie journal', 'Show journal'], M: ['Watch milestones', 'Episode premieres'] },
	'9B': { P: ['Latency runs', 'Heap runs'], S: ['Saved movie journal', 'Episode journal'], M: ['Movie journal', 'Season premieres'] },
	'10A': { P: ['Run durations', 'Memory ownership'], T: ['Shared genres', 'Matching reactions'], S: ['Recorded session hours', 'Rated albums'], M: ['Movie watch years', 'Watched episodes'] },
	'10B': { P: ['Query durations', 'Memory ownership'], T: ['Saved interests', 'Matching reactions'], S: ['Screen title genres', 'Album genre hierarchy'], M: ['Viewer reactions', 'Eligible episode library'] },
	'11A': { P: ['Median latency', 'Peak process memory'], T: ['Rating agreement', 'Reaction agreement'], S: ['Watched movies', 'Listened albums'], M: ['Your movie rating', 'Episode completion'] },
	'11B': { P: ['Median latency', 'Peak process memory'], T: ['Genre agreement', 'Saved interests'], S: ['Completed games', 'Rated albums'], M: ['Your movie rating', 'Episode coverage'] },
	'12A': { P: ['Run execution', 'Comparable runs'], S: ['Movie follow-through', 'Game follow-through'], M: ['Movie follow-through', 'Season retention'] },
	'12B': { P: ['Run execution', 'Comparable runs'], S: ['Movie follow-through', 'Album repeat listens'], M: ['Movie follow-through', 'Season retention'] },
	'13A': { T: ['Across media', 'Four taste signals'], S: ['Recorded watch genres', 'Saved work genres'], M: ['Viewer ratings', 'Episode coverage'] },
	'13B': { P: ['Median latency', 'Peak heap'], T: ['Across media', 'Four taste signals'], S: ['Recorded watch genres', 'Saved work genres'], M: ['Viewer ratings', 'Episode coverage'] },
	'13C': { P: ['Median latency', 'Peak heap'], T: ['Across media', 'Four taste signals'], S: ['Recorded watch genres', 'Saved work genres'], M: ['Viewer ratings', 'Episode coverage'] },
	'14A': { P: ['Probe run outcomes', 'Heap cohort outcomes'], S: ['Saved screen titles', 'Saved cross-media works'], M: ['Viewer journeys', 'Episode journeys'] },
	'14B': { S: ['Recorded watches', 'First watched episodes'], M: ['Movie watches', 'Episode watches'] },
	'14C': { P: ['Median latency', 'Peak heap'], T: ['Genres and ratings', 'Four taste signals'], S: ['Dated watch genres', 'Saved media works'], M: ['First and repeat watches', 'Episode completion'] }
};

function supplementalDatasetName(fixture: ChartFixture): string {
	const style = fixture.sourceId;
	if (fixture.context === 'T') {
		if (style === '2B') return fixture.variant === 'A' ? 'Rating distributions' : 'Saved interests';
		if (style === '2C' || style === '5A' || style === '6C') return 'Paired ratings';
		if (style === '3A') return fixture.variant === 'A' ? 'Rating gaps' : 'Reaction overlap';
		if (style === '3B') return fixture.variant === 'A' ? 'Shared genres' : 'Saved interests';
		if (style === '5C' || style === '10B') return 'Saved interest overlap';
		if (style === '6A') return fixture.variant === 'A' ? 'Shared title ratings' : 'Reaction agreement';
		if (style === '7A') return fixture.variant === 'A' ? 'Rating gaps' : 'Reaction agreement';
		if (style === '7B') return 'Paired rating distributions';
		if (style === '8A') return 'Taste signal history';
		if (style === '8B') return 'Paired rating history';
		if (style === '10A') return 'Shared saved genres';
		if (style === '11A' || style === '11B') return 'Rating agreement';
		return 'Taste signals';
	}
	return ({
		'1A': 'Recorded activity', '1B': 'Recorded activity', '1C': 'First/repeat events',
		'2A': 'Genre activity', '2B': 'First/repeat events', '2C': 'Activity changes',
		'3A': 'Genre composition', '3B': 'Genre composition', '3C': 'Rated audience coverage',
		'4A': 'Annual activity', '4B': 'September activity', '4C': 'Weekday rhythm',
		'5A': 'Ratings and repeats', '5B': 'Genre comparison', '5C': 'Saved and rated',
		'6A': 'Monthly event distribution', '6B': 'Daily event rhythm', '6C': 'Genre changes',
		'7A': 'Rating distribution', '7B': 'Paired rating distributions',
		'8A': 'Recorded event totals', '8B': 'Recorded event totals', '9A': 'Journal moments', '9B': 'Journal moments',
		'10A': 'Saved genres', '10B': 'Saved set overlap', '11A': 'Ratings this year', '11B': 'Ratings this year',
		'12A': 'Saved work follow-through', '12B': 'Saved work follow-through',
		'13A': 'Saved genres', '13B': 'Saved genres', '13C': 'Saved genres',
		'14A': 'Saved work journeys', '14B': 'Annual activity', '14C': 'Saved genre units'
	} as Record<string, string>)[style];
}

/** Names describe each selected sample; A/B suffixes only disambiguate equivalent encodings. */
export function getDatasetOptions(styleId: string, context: ChartContext, medium: ChartMedium): { value: ChartDataset; label: string }[] {
	const pair = fixtures.filter(fixture => fixture.sourceId === styleId && fixture.context === context);
	const labels = pair.map(fixture => {
		const options = supportedMediums(fixture);
		const resolvedMedium = options.includes(medium) ? medium : options[0];
		return resolvedMedium === 'Screen' || nativeMedium(fixture) === resolvedMedium
			? sourceDatasetNames[styleId][context]![fixture.variant === 'A' ? 0 : 1]
			: supplementalDatasetName(fixture);
	});
	return pair.map((fixture, index) => ({ value: fixture.variant, label: labels[0] === labels[1] ? `${labels[index]} ${fixture.variant}` : labels[index] }));
}

const shortMonth = (month: number) => monthLabels[month - 1];
const monthPattern = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const monthIndex = (name: string) => monthLabels.findIndex(month => month.toLowerCase() === name.slice(0, 3).toLowerCase());
function shortDate(date: string) {
	const [year, month, day] = date.split('-').map(Number);
	return `${day} ${shortMonth(month)} ${year}`;
}
function shortDateRange(start: string, end: string) {
	const [startYear, startMonth, startDay] = start.split('-').map(Number);
	const [endYear, endMonth, endDay] = end.split('-').map(Number);
	if (start === end) return shortDate(start);
	if (startDay === 1 && endDay === new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()) {
		if (startYear === endYear) return startMonth === endMonth ? `${shortMonth(startMonth)} ${startYear}` : `${shortMonth(startMonth)}–${shortMonth(endMonth)} ${startYear}`;
		return `${shortMonth(startMonth)} ${startYear}–${shortMonth(endMonth)} ${endYear}`;
	}
	if (startYear === endYear) return startMonth === endMonth ? `${startDay}–${endDay} ${shortMonth(startMonth)} ${startYear}` : `${startDay} ${shortMonth(startMonth)}–${endDay} ${shortMonth(endMonth)} ${startYear}`;
	return `${shortDate(start)}–${shortDate(end)}`;
}

/** Only return a period present in the fixture; non-temporal comparisons receive no invented date. */
export function getChartPeriod(model: ChartModel): string {
	if (model.calendar) return model.calendar.month === 0 ? String(model.calendar.year) : `${shortMonth(model.calendar.month)} ${model.calendar.year}`;
	if (number(model.raw.year) !== null) return String(model.raw.year);
	const period = string(model.raw.period);
	const dates = period.match(/\d{4}-\d{2}-\d{2}/g);
	if (dates?.length === 2 && !period.includes('(historical reference)')) return shortDateRange(dates[0], dates[1]);
	if (dates?.length === 2 && period.includes('(historical reference)')) {
		const current = period.match(/;\s*(.*?)\s*\(current\)/)?.[1].replace('September', 'Sep');
		return `${shortDateRange(dates[0], dates[1])}${current ? ` · ${current} current` : ''}`;
	}
	if (/^\d{4}$/.test(period)) return period;
	if (/\d{4} year to date/.test(period)) return `${period.match(/\d{4}/)?.[0]} year to date`;
	if (/^saved in\s*\d{4}$/.test(period)) return `Saved in ${period.match(/\d{4}/)?.[0]}`;
	if (typeof model.raw.asOf === 'string') return `As of ${shortDate(model.raw.asOf)}`;
	if (typeof model.raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(model.raw.date)) return shortDate(model.raw.date);
	const firstDate = model.events[0]?.date;
	if (firstDate && /^\d{4}-\d{2}-\d{2}$/.test(firstDate) && model.events.every(event => typeof event.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.date.slice(0, 7) === firstDate.slice(0, 7))) {
		const [year, month] = firstDate.split('-').map(Number);
		return `${shortMonth(month)} ${year}`;
	}
	const comparison = model.subtitle.match(new RegExp(`(${monthPattern})\\s*(?:−|–|-|and|vs\\.?)\\s*(${monthPattern})\\s*(\\d{4})`, 'i'));
	if (comparison) {
		const first = monthIndex(comparison[1]), second = monthIndex(comparison[2]);
		return `${monthLabels[Math.min(first, second)]}–${monthLabels[Math.max(first, second)]} ${comparison[3]}`;
	}
	const explicit = model.subtitle.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:–(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?\s*\d{4}|September\s*\d{4}/)?.[0];
	if (explicit) return explicit.replace(/([A-Za-z])(?=\d)/g, '$1 ');
	// Month arrays are explicit date labels, but they do not establish a year.
	const dateLabels = array(model.raw.dates ?? model.raw.x);
	if (dateLabels.length) {
		const dates = dateLabels.map(label => {
			if (typeof label !== 'string') return null;
			const monthFirst = label.match(new RegExp(`^(${monthPattern})\\s*(\\d{1,2})?$`, 'i'));
			const dayFirst = label.match(new RegExp(`^(\\d{1,2})\\s*(${monthPattern})$`, 'i'));
			if (!monthFirst && !dayFirst) return null;
			return { month: monthIndex(monthFirst?.[1] ?? dayFirst![2]), day: monthFirst?.[2] ? Number(monthFirst[2]) : dayFirst ? Number(dayFirst[1]) : null };
		});
		if (dates.every((date): date is { month: number; day: number | null } => date !== null)) {
			const ordered = dates.toSorted((a, b) => a.month - b.month || (a.day ?? 0) - (b.day ?? 0));
			const first = ordered[0], last = ordered.at(-1)!;
			if (dates.every(date => date.day === null)) return first.month === last.month ? monthLabels[first.month] : `${monthLabels[first.month]}–${monthLabels[last.month]}`;
			if (dates.every(date => date.day !== null && date.day >= 1 && date.day <= 31)) return first.month === last.month ? `${first.day}–${last.day} ${monthLabels[first.month]}` : `${first.day} ${monthLabels[first.month]}–${last.day} ${monthLabels[last.month]}`;
		}
	}
	if (/\b(?:2025|2026)\b/.test(model.subtitle) && /through|year|year to date/i.test(model.subtitle)) return model.subtitle.match(/\b(?:2025|2026)\b/)?.[0] ?? '';
	return '';
}
