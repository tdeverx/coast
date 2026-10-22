import {expect,test} from 'bun:test';
import {actionOptions,resolveAction,actionHref,actionUrl} from '../src/lib/actions';
import {libraryEntityOptions,libraryCountTitle} from '../src/lib/library';
import {searchSelection,searchDemand} from '../src/lib/search-selection';
const features={experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true};
test('action selection honors explicit links, remembered defaults and feature withdrawal',()=>{
 expect(actionOptions(features).map(option=>option.value)).toEqual(['watch','listen','play','read']);
 expect(resolveAction(new URLSearchParams('view=read'),'listen',features)).toBe('read');
 expect(resolveAction(new URLSearchParams(),'listen',features)).toBe('listen');
 expect(resolveAction(new URLSearchParams('view=listen'),'listen',{...features,experimentalMusic:false})).toBe('watch');
 expect(resolveAction(new URLSearchParams(),'watch',{...features,features:{screen:false}})).toBe('listen');
 expect(resolveAction(new URLSearchParams('view=all'),undefined,features)).toBe('watch');
});
test('action changes retain the main route and search text without carrying old filters or pages',()=>{
 expect(actionHref('/library','read')).toBe('/library?view=read');
 expect(actionHref('/search','listen','a & b')).toBe('/search?view=listen&q=a+%26+b');
 expect(actionHref('/profile/admin','play')).toBe('/for-you?view=play');
});
test('entity tabs respect reading gates and totals count entities independently of loaded cards',()=>{
 expect(libraryEntityOptions('listen',features).map(option=>option.value)).toEqual(['album','artist','track','playlist']);
 expect(libraryEntityOptions('read',{...features,experimentalBooks:false}).map(option=>option.value)).toEqual(['comic','series']);
 expect(libraryEntityOptions('read',{...features,experimentalComics:false}).map(option=>option.value)).toEqual(['book']);
 expect(libraryCountTitle(1750,'watch','movie')).toBe('1,750 movies');
 expect(libraryCountTitle(1,'listen','playlist')).toBe('1 playlist');
 expect(libraryCountTitle(62,'read','series')).toBe('62 series');
});
test('scoped search constrains both All rows and conflicting explicit subtype filters before demand',()=>{
 const selection=searchSelection(new URLSearchParams('q=test&view=all&availableType=movie&unavailableType=all&type=game'),'listen');
 expect(selection.rows).toEqual({available:{view:'listen',kind:'all'},unavailable:{view:'listen',kind:'all'}});
 expect(searchDemand(selection,features)).toEqual({watch:false,listen:true,play:false,read:false});
 const reading=searchSelection(new URLSearchParams('q=test&availableType=comic&unavailableType=book'),'read');
 expect(reading.rows.available).toEqual({view:'read',kind:'comic'});
 expect(searchDemand(reading,features)).toEqual({watch:false,listen:false,play:false,read:true});
});

test('withdrawn actions reset stale filters before server-side fallback work',()=>{
 const url=actionUrl(new URL('http://fixture/library?view=read&kind=comic&page=3&segment=continue'),'watch',{...features,experimentalBooks:false,experimentalComics:false});
 expect(url.search).toBe('?view=watch');
 expect(actionUrl(new URL('http://fixture/search?view=listen&q=title&type=album'),'watch',{...features,experimentalMusic:false}).search).toBe('?view=watch&q=title');
});
