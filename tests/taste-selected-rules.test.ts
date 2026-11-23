import {expect,test} from 'bun:test';
import {buildSelectedReference,scoreSelected,selectedWork,type SelectedWork,type SelectedDonor} from '../src/lib/social/taste-selected-rules';

const drama={id:'drama',name:'Drama'};
function show(id:string,family=id):SelectedWork {
  return selectedWork(id,family,'show',{genres:[drama]},{
    credits:[{id:12,role:'Creator'},{id:8,role:'Director'},{id:'unknown',role:'Showrunner'}]});
}
function donor(work:SelectedWork,stars:number,native=80):SelectedDonor {
  return {...work,stars,native,publicNative:native};
}
const abstain=()=>{throw Error('Unexpected audience lookup')};

test('exact lead teams transfer independently verified errors and a contrary rating vetoes the transfer',()=>{
  const target=show('new'),other=donor(show('other'),2.5);
  expect(target.leads).toEqual(['tmdb:12']);
  const predict=(donors:SelectedDonor[])=>scoreSelected(buildSelectedReference(donors),target,80,abstain);
  expect(predict([other])).toEqual({score:40,rule:'exact-team'});
  expect(predict([other,donor(show('different'),4)])).toEqual({score:80,rule:'personal'});
  expect(predict([other,donor(show('another','new'),4)]).score).toBe(80);
  const known=buildSelectedReference([other,donor(show('another','new'),4)]);
  expect(scoreSelected(known,target,80,abstain,{exact:new Map([['other',77]])}).score).toBe(43);
});

test('audience comparisons need personal agreement, multiple weak families and a pessimistic native estimate',()=>{
  const crowd=(id:string,score:number,rating:number,native:number)=>donor({...show(id),leads:[],audience:{score,votes:200}},rating,native);
  const low=crowd('a',3,1,85),mid=crowd('b',4,2,75),liked=crowd('c',9,5,85);
  const t={...show('new'),leads:[],audience:{score:3,votes:200}};
  const predict=(rows:SelectedDonor[],pessimistic:number)=>scoreSelected(buildSelectedReference(rows),t,79,()=>pessimistic);
  expect(predict([low,mid,liked],40)).toEqual({score:40,rule:'personalised-tmdb'});
  expect(predict([low,mid,liked],52).score).toBe(79);
  expect(predict([low,liked],40).score).toBe(79);
  expect(predict([{...low,stars:5},{...mid,stars:4},{...liked,stars:1}],40).score).toBe(79);
});

test('an independent disliked story needs a unique closest synopsis and its lead over a liked plot caps the adjustment',()=>{
  const t={...show('new'),tags:['tmdb:tag'],credits:['cast:tmdb:p'],leads:[],synopsis:[1,0]};
  const row=(id:string,stars:number,cos:number):SelectedDonor=>
    donor({...show(id),leads:[id],tags:[],credits:[],synopsis:[cos,Math.sqrt(1-cos*cos)]},stars);
  const tag={...row('tag',2.5,.15),tags:t.tags}, person={...row('actor',2,.1),credits:t.credits};
  const near=row('plot',2,.5), fav=row('favourite',5,.45);
  const ref=buildSelectedReference([tag,person,near,fav]);
  expect(scoreSelected(ref,t,80,abstain)).toEqual({score:76,rule:'story-credit'});
  expect(scoreSelected(ref,{...t,synopsis:undefined},80,abstain).score).toBe(80);
  expect(scoreSelected(buildSelectedReference([tag,person,near,{...fav,synopsis:near.synopsis}]),t,80,abstain).score).toBe(80);
});

test('separate people and company evidence uses the weaker genre margin and a matching favourite cancels the penalty',()=>{
  const target={...show('new'),leads:[],people:['tmdb:1'],companies:['studios:2']};
  function work(id:string,role:'people'|'companies',stars:number,genres:string[]) {
    return donor({...show(id),leads:[id],people:[],companies:[],genres,[role]:target[role]},stars);
  }
  const voters=[
    work('person-low-a','people',2,['drama']),work('person-low-b','people',2,['drama']),
    work('person-high','people',5,['comedy']),work('studio-low-a','companies',2,['drama']),
    work('studio-low-b','companies',2,['drama']),
  ];
  const predict=(genres:string[])=>scoreSelected(buildSelectedReference([...voters,work('studio-high','companies',5,genres)]),target,80,abstain);
  expect(predict(['drama','comedy'])).toEqual({score:55,rule:'person-company'});
  expect(predict(['drama'])).toEqual({score:80,rule:'personal'});
});
