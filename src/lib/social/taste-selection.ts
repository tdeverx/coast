import { isDescriptiveTasteDimension, ratingVote } from './taste-rating-model';
import type { TasteDimension, TasteFeature, TasteFeatures, TasteMedium, TasteReference, TasteWorkEvidence } from './taste-profile';

const maxRules = 64;
const maxExceptions = 12;
const maxPoints = 65;
const selectionFloor = 15;
const limits: Record<TasteMedium, { history: number; points: number }> = {
  movie: { history: 125, points: 65 },
  show: { history: 125, points: 65 },
  music: { history: 150, points: 40 },
  game: { history: 125, points: 45 },
  book: { history: 100, points: 50 },
  comic: { history: 150, points: 45 },
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const choicePoints = (score: number, pressure: number, protection = 0) =>
  Math.min(Math.max(0, score - selectionFloor), Math.round(maxPoints * pressure * (1 - protection)));

type Term = TasteFeature & { dimension: TasteDimension };
type Frequency = { count: number; weight: number; positive: number; negative: number };
type Counts = { known: number; weight: number; squares: number; occurrences: Map<number, Frequency> };
type Corpus = { cohorts: Map<number, Map<TasteDimension, Counts>>; rows: Uint32Array[]; weights: number[]; outcomes: number[] };
type Rule = {
  term: number; group: number; pressure: number;
  selected: number; catalogue: number; expected: number;
};
type SavedRule = {
  group: string; groupDimension?: TasteDimension; name?: string; within?: string;
  pressure: number; selected: number; expected: number; fitPressure?: number;
  exceptions?: Record<string, number>;
  supportedContexts?: {dimension:TasteDimension; id:string; strength:number}[];
};
export type TasteSelection = Partial<Record<TasteDimension, Record<string, SavedRule[]>>>;
export type TasteSelectionBreakdown = {
  name: string; within?: string; selected: number; expected: number; points: number; exception?: string; choiceOnly?:boolean;
};
export type TasteSelectionSummary = Pick<TasteSelectionBreakdown, 'within' | 'selected' | 'expected'> & { value: number };

function jointApproval({positive,negative}:Pick<Frequency,'positive'|'negative'>) {
  return 1 - clamp(negative / Math.max(2, positive + negative));
}

function choiceKey(dimension: TasteDimension, id: string) {
  return dimension + ':' + id;
}

export function createTasteSelectionTrainer(medium: TasteMedium = 'movie') {
  const limit = limits[medium];
  const vocabulary = new Map<string, number>();
  const terms: Term[] = [];
  const corpus = (): Corpus => ({ cohorts: new Map(), rows: [], weights: [], outcomes: [] });
  const history = corpus(), catalogue = corpus();

  function tokenFor(dimension: TasteDimension, feature: TasteFeature) {
    const key = choiceKey(dimension, feature.id);
    const existing = vocabulary.get(key);
    if (existing !== undefined) return existing;
    const token = terms.length;
    terms.push({ ...feature, dimension });
    vocabulary.set(key, token);
    return token;
  }

  function add(target: Corpus, features: TasteFeatures, weight: number, outcome = 0) {
    if (!Number.isFinite(weight) || weight <= 0) return;
    const anchorDimension = features.genres?.length ? 'genres'
      : medium === 'book' || medium === 'comic' ? 'tags' : 'genres';
    const anchors = [...new Set((features[anchorDimension] ?? []).slice(0, 6)
      .filter(feature => feature.id).map(feature => tokenFor(anchorDimension, feature)))];
    const cohorts = [-1, ...anchors].map(group => {
      const counts = target.cohorts.get(group) ?? new Map<TasteDimension, Counts>();
      target.cohorts.set(group, counts);
      return { group, counts };
    });
    const fingerprint: number[] = [];
    for (const [dimension, entries] of Object.entries(features) as [TasteDimension, TasteFeature[]][]) {
      if (!entries?.length) continue;
      const tokens = new Set(entries.filter(feature => feature.id).map(feature => tokenFor(dimension, feature)));
      if (!tokens.size) continue;
      fingerprint.push(...tokens);
      for (const { group, counts } of cohorts) {
        if (group >= 0 && !isDescriptiveTasteDimension(dimension)) continue;
        let bucket = counts.get(dimension);
        if (!bucket) {
          bucket = { known: 0, weight: 0, squares: 0, occurrences: new Map() };
          counts.set(dimension, bucket);
        }
        bucket.known++; bucket.weight += weight; bucket.squares += weight * weight;
        for (const token of tokens) {
          if (group >= 0 && terms[token].id === terms[group].id) continue;
          const f = bucket.occurrences.get(token);
          if (f) {
            f.count++;
            f.weight += weight;
            f.positive += Math.max(0,outcome);
            f.negative += Math.max(0,-outcome);
          } else bucket.occurrences.set(token, { count: 1, weight, positive:Math.max(0,outcome), negative:Math.max(0,-outcome) });
        }
      }
    }
    if (fingerprint.length) {
      target.rows.push(Uint32Array.of(anchors.length, ...anchors, ...fingerprint));
      target.weights.push(weight);
      target.outcomes.push(outcome);
    }
  }

  function learnRules() {
    const rules: Rule[] = [];
    for (const [group, buckets] of catalogue.cohorts) for (const [dimension, baseline] of buckets) {
      const chosen = history.cohorts.get(group)?.get(dimension);
      if (!chosen) continue;
      const effective = baseline.weight ** 2 / baseline.squares;
      const historyMinimum = group >= 0 ? 40 : limit.history;
      const maturity = Math.min(clamp((chosen.known - historyMinimum * .75)/(historyMinimum * .25)), clamp((effective - 60)/40),
        clamp((history.rows.length-limit.history+1)/(limit.history*.2)));
      if (!maturity) continue;
      for (const [term, frequency] of baseline.occurrences) {
        const prevalence = frequency.weight / baseline.weight;
        const expected = prevalence * chosen.known;
        const selected = chosen.occurrences.get(term)?.count ?? 0;
        const error = Math.sqrt(expected * (1 - prevalence) * (1 + chosen.known / effective));
        if (!error || !expected) continue;
        const confidence = (expected - selected - .5) / error;
        // Fade at the admission boundaries so a single additional catalogue title cannot
        // remove a well-established preference. Raw sample size still limits support.
        const support = Math.min(maturity, clamp((frequency.count - 4)/4), clamp((expected - 14)/6),
          clamp((.25 - prevalence)/.08), clamp((.45 - selected/expected)/.1),
          clamp((1.7 - selected/Math.sqrt(expected))/.35), clamp((confidence - 1.75)/1.75));
        if (!support) continue;
        const priority = isDescriptiveTasteDimension(dimension) ? 1 : .22;
        const pressure = Math.sqrt(1 - (selected + 2)/(expected + 2)) * support * priority * limit.points / maxPoints;
        if (pressure * maxPoints < .5) continue;
        rules.push({ term, group, pressure, selected, catalogue: frequency.weight, expected });
      }
    }
    return rules.sort((a, b) => b.pressure - a.pressure || a.term - b.term || a.group - b.group).slice(0, maxRules);
  }

  function supportedContexts(rule: Rule, dimension: TasteDimension, exemptChoices:Map<number,number>) {
    if (!isDescriptiveTasteDimension(dimension)) return;
    const supported: NonNullable<SavedRule['supportedContexts']> = [];
    for (const [group, counts] of history.cohorts) {
      if (group < 0 || group === rule.group) continue;
      const chosen = counts.get(dimension), offered = catalogue.cohorts.get(group)?.get(dimension);
      if (!chosen || !offered || chosen.known < 30 || offered.weight ** 2 / offered.squares < 100) continue;
      const observations = chosen.occurrences.get(rule.term), opportunities = offered.occurrences.get(rule.term);
      if (!observations || !opportunities || !opportunities.weight) continue;
      const expected = chosen.known * opportunities.weight / offered.weight;
      // Seeing a few favoured creators in a second genre cannot exempt that entire genre.
      const ordinary = observations.count - (exemptChoices.get(group) ?? 0);
      const support = Math.min(clamp((ordinary-3)/2),clamp((opportunities.count-4)/4),
        clamp((ordinary/expected-.35)/.12));
      const strength = support * jointApproval(observations);
      if (strength > 0) {
        const {dimension, id} = terms[group];
        supported.push({dimension, id, strength});
      }
    }
    return supported.length ? supported : undefined;
  }

  function learnExceptions(rules: Rule[], reference: TasteReference) {
    const possible = new Map<number, { explicit: number; value: number; specificity:number }>();
    const byTerm = new Map<number, number[]>();
    for (const [index, rule] of rules.entries()) {
      if (rule.selected < 3) continue;
      const indices = byTerm.get(rule.term) ?? [];
      if (!indices.length) byTerm.set(rule.term, indices);
      indices.push(index);
    }
    if (!byTerm.size) return rules.map(() => undefined);
    for (const [token, { dimension, id }] of terms.entries()) {
      const lookup = reference.dimensions[dimension];
      const match = dimension !== 'genres' && lookup && Object.hasOwn(lookup, id) ? lookup[id] : undefined;
      // A candidate's language or another near-universal property is too broad to explain a specific exception.
      if (match && match[2] < reference.works * .22)
        possible.set(token, { value: match[1], explicit: match[3], specificity:clamp((.22-match[2]/reference.works)/.05) });
    }
    function associations(corpus: Corpus) {
      const result = rules.map(() => ({counts:new Map<number,Frequency>(), known:new Map<TasteDimension,number>()}));
      for (const [rowIndex,row] of corpus.rows.entries()) {
        const anchorEnd = 1 + row[0];
        const features = row.subarray(anchorEnd);
        for (const token of features) for (const i of byTerm.get(token) ?? []) {
          const rule = rules[i];
          if (rule.group >= 0 && row.subarray(1, anchorEnd).indexOf(rule.group) === -1) continue;
          const {counts,known} = result[i];
          const seen=new Set<TasteDimension>();
          for (const other of features) {
            const d=terms[other].dimension;
            if(!seen.has(d)){
              seen.add(d);
              known.set(d,(known.get(d)??0)+corpus.weights[rowIndex]);
            }
            if (!possible.has(other) || terms[other].id === terms[token].id) continue;
            const joint = counts.get(other) ?? {count:0, weight:0, positive:0, negative:0};
            joint.count++; joint.weight += corpus.weights[rowIndex];
            joint.positive += Math.max(0,corpus.outcomes[rowIndex]);
            joint.negative += Math.max(0,-corpus.outcomes[rowIndex]);
            counts.set(other,joint);
          }
        }
      }
      return result;
    }
    const selected = associations(history), offered = associations(catalogue);
    return rules.map((rule, index) => {
      const supported: [string, number][] = [];
      for (const [token, {count,positive,negative}] of selected[index].counts) {
        const available = offered[index].counts.get(token);
        const ratio = count / rule.selected;
        if (count < 3 || !available || available.count < 3 || ratio < 0.45) continue;
        const { value, explicit, specificity } = possible.get(token)!;
        if (value < .12 && (positive < 3 || positive < 3 * negative)) continue;
        // A broadly liked creator can have a poor record specifically inside this niche.
        const {dimension}=terms[token];
        // A blank structural field is unknown. It cannot establish that an otherwise
        // near-universal language, region, era or certification is a narrow exception.
        const structural = dimension==='languages'||dimension==='countries'||dimension==='decades'||dimension==='ageRatings';
        const population = structural ? offered[index].known.get(dimension)! : rule.catalogue;
        const strength = specificity * jointApproval({positive,negative}) * clamp((ratio - available.weight / population) / 0.53) * clamp(count / 3.5)
          * (explicit >= 3 || value >= 0.65 || count >= 5 ? 1 : 0.92);
        if (strength >= 0.1) {
          const { dimension, id } = terms[token];
          supported.push([choiceKey(dimension, id), strength]);
        }
      }
      return supported.length ? Object.fromEntries(supported.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxExceptions)) : undefined;
    });
  }

  /** Selection measures opportunity. Only independent corroboration makes it strong
   * evidence about enjoyment of a work with an otherwise established match. */
  function enjoymentSupport(rules:Rule[], exceptions:(Record<string,number>|undefined)[]) {
    const totals = rules.map(() => ({ covered:0, offered:0, positive:0, negative:0, exemptContexts:new Map<number,number>() }));
    const byTerm = new Map<number,number[]>();
    for(const [index,rule] of rules.entries()){
      const indices=byTerm.get(rule.term)??[];
      indices.push(index);
      byTerm.set(rule.term,indices);
    }
    for(const pool of [history,catalogue])for(const [rowIndex,row] of pool.rows.entries()){
      const end = row[0]+1, features=row.subarray(end);
      for(const token of features)for(const i of byTerm.get(token)??[]){
        const rule=rules[i];
        if(rule.group>=0&&row.subarray(1,end).indexOf(rule.group)===-1)continue;
        const exception=exceptions[i];
        let protection=0;
        if(exception)for(const other of features){
          const term=terms[other];
          protection=Math.max(protection,exception[choiceKey(term.dimension,term.id)]??0);
        }
        if(pool===catalogue){
          totals[i].offered+=pool.weights[rowIndex]*protection;
          continue;
        }
        if(protection)for(const context of row.subarray(1,end)){
          const contexts=totals[i].exemptContexts;
          contexts.set(context,(contexts.get(context)??0)+protection);
        }
        const residual=history.outcomes[rowIndex]*(1-protection);
        totals[i].covered+=protection;
        totals[i].positive+=Math.max(0,residual);
        totals[i].negative+=Math.max(0,-residual);
      }
    }
    return totals.map(({covered,offered,positive,negative,exemptContexts},i)=>{
      const rule=rules[i];
      // A narrowly favoured subset can explain a shortage *within* its context.
      // Extending that evidence to every other genre penalises unrelated matches.
      const narrow=rule.group>=0 ? clamp((covered/Math.max(1,rule.selected)-.45)/.40)*clamp((covered-2)/3) : 0;
      const approval=1-.85*positive/(positive+negative+2);
      const dislike=clamp((negative-positive)/(2+negative+positive));
      const abstention=clamp((rule.expected-25)/75)*clamp(1-rule.selected/3);
      // Compare the remaining ordinary choices after accounting for the exception in
      // BOTH pools. Concentration gives independent evidence when the raw deficit is marginal.
      const residualExpected=rule.expected*(1-offered/rule.catalogue);
      const residualChosen=Math.max(0,rule.selected-covered);
      const exceptionalShortfall = residualExpected>0
        ? clamp((residualExpected-residualChosen-.5)/(3.5*Math.sqrt(residualExpected)))
          * clamp((residualExpected-8)/8)*clamp(1-residualChosen/residualExpected) : 0;
      const nicheFit=narrow*approval*exceptionalShortfall;
      const corroboratedAbsence=rule.group>=0
        ? clamp((rule.expected-12)/8)*clamp((.16-rule.selected/rule.expected)/.10)*approval : 0;
      const calibrated=Math.max(Math.min(nicheFit,3*rule.pressure),rule.pressure*Math.max(dislike,abstention,corroboratedAbsence));
      const cap=limit.points/maxPoints, strength=clamp(calibrated/cap);
      // Weak proxies provide little evidence of enjoyment. Shrink continuously when
      // their support is low and retain well-corroborated local patterns.
      const reliability=strength**2/(strength**2+(1-strength)**2);
      return {fitPressure:cap*strength*reliability,exemptContexts};
    });
  }

  return {
    addHistory(features: TasteFeatures, evidence?: TasteWorkEvidence) {
      let outcome = 0;
      if (evidence) {
        if (evidence.dropped && (evidence.rating ?? 3) <= 3) outcome = -1;
        else if (evidence.rating !== null && evidence.rating !== 3)
          outcome = ratingVote(evidence.rating) * (evidence.ratingReliability ?? 1);
        else if (evidence.explicit > 0 || evidence.deliberateReturn) outcome = .9;
      }
      add(history, features, 1, outcome);
    },
    addCatalogue: (features: TasteFeatures, weight = 1) => add(catalogue, features, weight),
    ready: () => history.rows.length >= limit.history,
    prepare(reference: TasteReference): TasteSelection | undefined {
      if (history.rows.length < limit.history) return;
      const rules = learnRules();
      if (!rules.length) return;
      const exceptions = learnExceptions(rules, reference);
      const support = enjoymentSupport(rules, exceptions);
      const result: TasteSelection = {};
      for (const [index, rule] of rules.entries()) {
        const term = terms[rule.term];
        const dimension = result[term.dimension] ??= Object.create(null);
        (dimension[term.id] ??= []).push({
          group: terms[rule.group]?.id ?? '', groupDimension: terms[rule.group]?.dimension,
          within: terms[rule.group]?.name, name: term.name, pressure: rule.pressure, fitPressure:support[index].fitPressure, selected: rule.selected, expected: rule.expected,
          exceptions: exceptions[index], supportedContexts: supportedContexts(rule, term.dimension, support[index].exemptContexts),
        });
      }
      return result;
    },
  };
}

/** Apply the strongest corroborated pattern once. A proven specific preference can cancel it. */
export function tasteSelectionAdjustment(selection: TasteSelection | undefined, features: TasteFeatures, score: number, details?: TasteSelectionBreakdown[], choiceOnly=false) {
  if (!selection) return 0;
  let match: SavedRule | undefined;
  let name = '';
  let tieBreak = '';
  let points = 0;
  let exception: string | undefined;
  for (const [dimension, rules] of Object.entries(selection) as [TasteDimension, NonNullable<TasteSelection[TasteDimension]>][]) {
    for (const feature of features[dimension] ?? []) {
      if (!Object.hasOwn(rules, feature.id)) continue;
      for (const rule of rules[feature.id]) {
        if (rule.group && !features[rule.groupDimension ?? 'genres']?.some(feature => feature.id === rule.group)) continue;
        const protection = strongestException(rule, features);
        const adjustment = choicePoints(score, choiceOnly?rule.pressure:rule.fitPressure??rule.pressure, protection.strength);
        const key = choiceKey(dimension, feature.id) + '/' + rule.group;
        if (!match || adjustment > points || (adjustment === points && (
          rule.pressure > match.pressure || (rule.pressure === match.pressure && key < tieBreak)
        ))) {
          match = rule;
          name = feature.name;
          tieBreak = key;
          points = adjustment;
          exception = protection.name;
        }
      }
    }
  }
  if (!match) return 0;
  details?.push({ name, within: match.within ?? features[match.groupDimension ?? 'genres']?.find(feature => feature.id === match.group)?.name,
    selected: match.selected, expected: match.expected, points: points ? -points : 0, exception });
  return points ? -points : 0;
}

function strongestException(rule: SavedRule, features: TasteFeatures) {
  let strength = 0;
  let name: string | undefined;
  for (const context of rule.supportedContexts ?? []) {
    if (context.strength <= strength) continue;
    const feature = features[context.dimension]?.find(candidate => candidate.id === context.id);
    if (feature) { strength = context.strength; name = feature.name; }
  }
  if (rule.exceptions) {
    for (const [dimension, entries] of Object.entries(features) as [TasteDimension, TasteFeature[] | undefined][]) {
      for (const entry of entries ?? []) {
        const match = rule.exceptions[choiceKey(dimension, entry.id)] ?? 0;
        if (match > strength) {
          strength = match;
          name = entry.name;
        }
      }
    }
  }
  return { strength, name };
}

/** Show the feature on its own. Exceptions are applied when a title also matches one. */
export function summarizeTasteSelection(rules: readonly SavedRule[] | undefined, value: number, genreNames: Record<string, string>): TasteSelectionSummary | undefined {
  const strongest = rules?.[0];
  if (!strongest) return;
  return {
    within: strongest.within ?? (Object.hasOwn(genreNames, strongest.group) ? genreNames[strongest.group] : undefined),
    selected: strongest.selected, expected: strongest.expected,
    value: value - choicePoints(50 + 50 * value, strongest.pressure) / 50,
  };
}
