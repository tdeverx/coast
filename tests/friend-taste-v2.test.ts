import {expect,test} from 'bun:test';
import {compareFriendItemV2,compareVisibleTastesV2,validatedFriendContextV2,validateFriendForecastsV2,type PairedFriendForecastV2} from '../src/lib/social/friend-taste-v2';

const trait=(id:string,affinity:number,works=5)=>({id,name:id,dimension:'genres',affinity,works,independent:works,confidence:70});
test('watching the same things measures overlap independently of agreement',()=>{
  const result=compareVisibleTastesV2([],[],Array.from({length:5},()=>({mine:.5,theirs:5})));
  expect(result.agreement.score).toBe(0);
  expect(result.score).toBe(0);
  expect(result.preferences.score).toBeNull();
});
test('different titles can yield shared preference, unsupported or unobserved traits do not imply dislike',()=>{
  const left=[trait('drama',90),trait('comedy',20),trait('unconfirmed',2,1)];
  const right=[trait('drama',85),trait('comedy',15),trait('unconfirmed',98,1)];
  const fit=compareVisibleTastesV2(left,right,[]);
  expect(fit.score).toBeGreaterThan(75);
  expect(fit.agreement.score).toBeNull();
  expect(fit.preferences.traits).toBe(2);
  expect(compareVisibleTastesV2(right,left,[]).score).toBe(fit.score);
  expect(compareVisibleTastesV2(left,[],[]).score).toBeNull();
});

const day=(t:number)=>new Date(Date.UTC(2020,0,t)).toISOString();
function forecasts(disagree=false):PairedFriendForecastV2[] {
  return Array.from({length:24},(_,i)=>{
    const liked=i%2===0;
    return {id:'work-'+i,personal:50,friendStars:(disagree?!liked:liked)?5:1,viewerStars:liked?5:1,
      predictedAt:day(i+30),friendObservedAt:day(i+29),viewerRatedAt:day(i+31)};
  });
}
test('a peer must improve paired personal forecasts on genuinely later days; current title is excluded',()=>{
  const rows=forecasts(), gate=validateFriendForecastsV2(rows,'work-0');
  expect(gate.state).toBe('validated');
  expect(gate.earlier.works+gate.later.works).toBe(23);
  expect(compareFriendItemV2(67,5,gate).assistedScore).toBeGreaterThan(67);
  expect(compareFriendItemV2(67,1,gate).assistedScore).toBeLessThan(67);
  expect(compareFriendItemV2(null,5,gate).assistedScore).toBeNull();
  expect(validateFriendForecastsV2(forecasts(true),'target').state).toBe('no-measured-gain');
  const indiscriminate=rows.map((row,i)=>({...row,friendStars:5,viewerStars:i%4?5:1}));
  expect(validateFriendForecastsV2(indiscriminate,'target').state).toBe('no-measured-gain');
  expect(validateFriendForecastsV2(rows.map(r=>({...r,friendObservedAt:r.viewerRatedAt})),'target').earlier.works).toBe(0);
  expect(validateFriendForecastsV2(rows.map(r=>({...r,viewerRatedAt:day(100)})),'target').state).toBe('insufficient-evidence');
  const repeated=Array.from({length:24},()=>rows[0]);
  expect(validateFriendForecastsV2(repeated,'target').state).toBe('insufficient-evidence');
});

test('watch-only forecasts earn a smaller independent correction and cannot borrow a rating validation',()=>{
  const rows=forecasts().map((r,i)=>({...r,friendStars:null,viewerStars:i%4?5:1,personal:i%4?55:10}));
  expect(validateFriendForecastsV2(rows,'target','rating').state).toBe('insufficient-evidence');
  const missing=validateFriendForecastsV2([],'target','watch');
  expect(compareFriendItemV2(50,null,missing,true).assistedScore).toBeNull();
  expect(compareFriendItemV2(50,null,missing,false).reason).toBe('no-visible-opinion');
  const watched=validateFriendForecastsV2(rows,'target','watch');
  expect(watched.state).toBe('validated');
  expect(compareFriendItemV2(50,null,watched,true).assistedScore).toBe(52);
});

test('sufficient independent genre evidence may admit or veto a peer; a franchise alone cannot',()=>{
  const drama=forecasts().map(row=>({...row,genres:['drama']}));
  const docs=forecasts(true).map(row=>({...row,id:'d-'+row.id,genres:['documentary']}));
  const records=[...drama,...docs];
  expect(validatedFriendContextV2(records,'new','rating',['drama']).gate.state).toBe('validated');
  expect(validatedFriendContextV2(records,'new','rating',['documentary']).gate.state).toBe('no-measured-gain');
  expect(validatedFriendContextV2(records,'new','rating',['unfamiliar']).scope).toBe('medium');
  expect(validateFriendForecastsV2(drama.map(row=>({...row,franchise:'one-series'})),'new').state).toBe('insufficient-evidence');
});
