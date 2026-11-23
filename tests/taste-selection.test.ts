import { expect, test } from 'bun:test';
import { createTasteAccumulator, namedFeatures, prepareTasteReference, scorerFromReference, type TasteFeatures, type TasteMedium } from '../src/lib/social/taste-profile';
import { createTasteSelectionTrainer, summarizeTasteSelection, tasteSelectionAdjustment } from '../src/lib/social/taste-selection';

const specificFeature = {
  movie: 'studios', show: 'networks', music: 'artists', game: 'developers', book: 'writers', comic: 'franchises',
} as const;
for (const medium of Object.keys(specificFeature) as TasteMedium[]) for (const withRatings of [true, false]) {
  test(`supported choices and specific exceptions apply to ${medium} (${withRatings ? 'rated' : 'unrated'})`, () => {
    const trainer = createTasteSelectionTrainer(medium);
    const dimension = specificFeature[medium];
    const taste = createTasteAccumulator();
    const animation = namedFeatures(['Animation']);
    const niche = namedFeatures(['Stop-motion']);
    const studio = namedFeatures(['Independent studio']);
    const unrelated = namedFeatures(['Beyond the Sea']);
    const ordinary: TasteFeatures = { genres: animation, tags: namedFeatures(['Journey']) };
    const specialist: TasteFeatures = { ...ordinary, tags: niche };
    const exception: TasteFeatures = { ...specialist, [dimension]: studio };
    for (let index = 0; index < 180; index++) {
      const features = index < 5 ? exception : index < 14 ? { ...ordinary, [dimension]: unrelated } : ordinary;
      trainer.addHistory(features);
      taste.add({ rating: withRatings ? 4.5 : null, implicit: 3, explicit: 0, consumed: true, repeated: false }, features);
    }
    for (let index = 0; index < 500; index++) {
      trainer.addCatalogue(index < 8 ? exception : index < 70 ? specialist : index < 100 ? { ...ordinary, [dimension]: unrelated } : ordinary);
    }
    const reference = prepareTasteReference(taste.snapshot());
    const selection = trainer.prepare(reference);
    const baseline = scorerFromReference(reference);
    const score = scorerFromReference(JSON.parse(JSON.stringify({ ...reference, selection })), true);
    expect(selection?.tags?.['stop-motion']).toBeDefined();
    expect(score(specialist).score!).toBeLessThan(baseline(specialist).score!);
    expect(score(specialist).breakdown?.selection).toMatchObject({ name: 'Stop-motion', selected: 5 });
    expect(score(exception).score!).toBeGreaterThanOrEqual(baseline(exception).score! - 5);
    expect(score(exception).breakdown?.selection).toMatchObject({ exception: 'Independent studio' });
    expect(score(ordinary).score).toBe(baseline(ordinary).score);
    // Compare at the same starting score. Coverage can change the headline and the
    // 15% selection floor can then leave a different number of points to subtract.
    expect(tasteSelectionAdjustment(selection,{...specialist,[dimension]:unrelated},80))
      .toBe(tasteSelectionAdjustment(selection,specialist,80));
  });
}

test('sparse profiles and unmeasured features supply no choice evidence', () => {
  const trainer = createTasteSelectionTrainer();
  const action = { genres: namedFeatures(['Action']) };
  for (let index = 0; index < 100; index++) trainer.addHistory(action);
  for (let index = 0; index < 500; index++) trainer.addCatalogue(index < 50
    ? { ...action, tags: namedFeatures(['Robots']) } : action);
  expect(trainer.ready()).toBe(false);
  expect(trainer.prepare({ works: 100, dimensions: {} })).toBeUndefined();
});


test('a specific exception only overrides its own affinity, leaving independent signals active', () => {
  const selection = { tags: {
    mecha: [{ group: 'animation', pressure: 0.8, selected: 5, expected: 26, exceptions: {'studios:preferred studio': 1} }],
    dystopia: [{ group: '', pressure: 0.27, selected: 3, expected: 25 }],
  } };
  const specific = { genres: namedFeatures(['Animation']), studios: namedFeatures(['Preferred studio']) };
  expect(tasteSelectionAdjustment(selection, {...specific, tags: namedFeatures(['Mecha'])}, 90)).toBe(0);
  expect(tasteSelectionAdjustment(selection, {...specific, tags: namedFeatures(['Mecha', 'Dystopia'])}, 90)).toBe(-18);
  expect(tasteSelectionAdjustment(selection, {tags: namedFeatures(['Mecha', 'Dystopia'])}, 90)).toBe(-18);
  expect(tasteSelectionAdjustment(selection, {...specific, tags: namedFeatures(['Dystopia'])}, 10)).toBe(0);
  expect(summarizeTasteSelection(selection.tags.mecha, 0.64, {animation:'Animation'}))
    .toMatchObject({within:'Animation', value:expect.closeTo(-0.4), selected:5, expected:26});
});

test('small prevalence changes are smooth and strong avoidance can supply a limited choice-only estimate', () => {
  const common={genres:namedFeatures(['Adventure']),tags:namedFeatures(['Familiar'])};
  const rare={genres:common.genres,tags:namedFeatures(['Rare tag'])};
  function fit(n:number, weight=1) {
    const trainer=createTasteSelectionTrainer(),history=createTasteAccumulator();
    for(let i=0;i<180;i++){
      trainer.addHistory(common);
      history.add({rating:5,explicit:0,implicit:3,consumed:true,repeated:false},common);
    }
    for(let i=0;i<500;i++)trainer.addCatalogue(i<n?rare:common,i<n?weight:1);
    const reference=prepareTasteReference(history.snapshot());
    return scorerFromReference({...reference,selection:trainer.prepare(reference)},true);
  }
  const first=fit(85),next=fit(86);
  expect(Math.abs(first(rare).score!-next(rare).score!)).toBeLessThanOrEqual(2);
  expect(next(rare).score!).toBeLessThan(50);
  expect(fit(86,.05)(rare).score!).toBeGreaterThan(next(rare).score!);
  const only=first({tags:rare.tags});
  expect(only.score).toBeGreaterThanOrEqual(34);
  expect(only.score).toBeLessThan(50);
  expect(only.confidence).toBeLessThan(30);
  expect(only.breakdown?.selection).toMatchObject({choiceOnly:true,selected:0});
});

test('joint dislike vetoes a studio exception even if it is loved outside the genre', () => {
  const trainerFor=(jointRating:number|null,dropped=false)=>{
    const trainer=createTasteSelectionTrainer(),history=createTasteAccumulator();
    const ordinary={genres:namedFeatures(['Animation']),tags:namedFeatures(['Travel'])};
    const niche={...ordinary,tags:namedFeatures(['Rare'])};
    const studio={studios:namedFeatures(['Studio A'])};
    for(let i=0;i<300;i++){
      const features=i<6?{...niche,...studio}:i<31?{...ordinary,...studio}:ordinary;
      const evidence={rating:i<6?jointRating:5,explicit:0,implicit:3,consumed:true,repeated:false,dropped:i<6&&dropped};
      trainer.addHistory(features,evidence);
      history.add(evidence,features);
    }
    for(let i=0;i<1000;i++)trainer.addCatalogue(i<5?{...niche,...studio}:i<100?niche:ordinary);
    const reference=prepareTasteReference(history.snapshot());
    return tasteSelectionAdjustment(trainer.prepare(reference),{...niche,...studio},80);
  };
  expect(trainerFor(5)).toBe(0);
  expect(trainerFor(null)).toBe(0);
  expect(trainerFor(1)).toBeLessThan(-25);
  expect(trainerFor(null,true)).toBeLessThan(-25);
});

test('a subject anchors a more specific topic when reading data lacks genres',()=>{
  const trainer=createTasteSelectionTrainer('book');
  const book=(subject:string,tag:string)=>({tags:namedFeatures([subject,tag])});
  for(let i=0;i<300;i++)trainer.addHistory(i<150?book('History','Europe'):book('Fiction','Cold war'));
  for(let i=0;i<1200;i++)trainer.addCatalogue(i<75?book('History','Cold war'):i<600?book('History','Europe'):book('Fiction','Cold war'));
  const selection=trainer.prepare({works:300,dimensions:{}});
  expect(selection?.tags?.['cold war']?.find(rule=>rule.group==='history')).toMatchObject({within:'History',groupDimension:'tags',selected:0});
  expect(tasteSelectionAdjustment(selection,book('History','Cold war'),80,undefined,true)).toBeLessThan(0);
  expect(tasteSelectionAdjustment(selection,book('Fiction','Cold war'),80)).toBe(0);
});

test('missing metadata and overlapping genres cannot turn a creator exception into a blanket exemption',()=>{
  const trainer=createTasteSelectionTrainer();
  const history=createTasteAccumulator();
  const genre=namedFeatures(['Animation']),both=namedFeatures(['Animation','Fantasy']);
  const language=namedFeatures(['Language A']),creator=namedFeatures(['Creator A']);
  const ordinary={genres:genre,tags:namedFeatures(['Travel'])},niche={...ordinary,tags:namedFeatures(['Rare'])};
  const exception={...niche,genres:both,directors:creator,languages:language};
  const evidence={rating:5,explicit:0,implicit:3,consumed:true,repeated:false};
  for(let i=0;i<220;i++){
    const features=i<5?exception:i<7?niche:i<45?{...ordinary,genres:both}:ordinary;
    trainer.addHistory(features,evidence);
    history.add(evidence,features);
  }
  for(let i=0;i<600;i++){
    const features=i<7?exception:i<80?niche:i<240?{...ordinary,genres:both}:ordinary;
    trainer.addCatalogue(features);
  }
  const rules=trainer.prepare(prepareTasteReference(history.snapshot()));
  const adjustment=(features:TasteFeatures)=>tasteSelectionAdjustment(rules,features,90);
  expect(adjustment(exception)).toBe(0);
  expect(adjustment(niche)).toBeLessThan(0);
  expect(adjustment({...niche,languages:language,genres:both})).toBe(adjustment(niche));
});

test('choosing less often preserves a strong, broadly supported enjoyment of the feature',()=>{
  const trainer=createTasteSelectionTrainer();
  const history=createTasteAccumulator(),features=(n:number)=>({genres:namedFeatures(['Animation']),tags:namedFeatures([n<6?'Rare':'Common'])});
  const evidence={rating:5,explicit:0,implicit:3,consumed:true,repeated:false};
  for(let i=0;i<300;i++){trainer.addHistory(features(i),evidence);history.add(evidence,features(i));}
  for(let i=0;i<1000;i++)trainer.addCatalogue(features(i<100?0:10));
  const reference=prepareTasteReference(history.snapshot()),selection=trainer.prepare(reference);
  expect(selection?.tags?.rare?.length).toBeGreaterThan(0);
  expect(tasteSelectionAdjustment(selection,features(0),90)).toBe(0);
  expect(tasteSelectionAdjustment(selection,features(0),50,undefined,true)).toBeLessThan(0);
});
