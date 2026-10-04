import {expect,test} from 'bun:test';
import {genreRowTitle,relatedRowTitle,popularRowTitle,genreTitlePatterns,relatedTitlePatterns,type DynamicMedium,type DynamicKind} from '../src/lib/experiments/row-titles';
import type {GenreReason} from '../src/lib/experiments/row-ranking';

const visits=Array.from({length:500},(_,i)=>`visit-${i}`);
test('genre wording varies across visits, remains stable within a visit and preserves medium',()=>{
  const media:[DynamicMedium,DynamicKind,string][]=[['screen','movie','movies'],['screen','show','shows'],['game','game','games'],['music','album','albums']];
  for(const [category,kind,items] of media)for(const reason of ['liked','watched','saved','explore'] as GenreReason[]){
    const titles=visits.map(seed=>genreRowTitle(category,'Animation',kind,reason,seed));
    expect(new Set(titles).size).toBe(genreTitlePatterns[reason].length);
    expect(titles).toEqual(visits.map(seed=>genreRowTitle(category,'Animation',kind,reason,seed)));
    expect(titles.every(title=>title.toLowerCase().includes('animation')&&title.includes(items)&&!title.includes('{'))).toBe(true);
  }
});
test('saved and exploratory wording never invents a like, watch or friend action',()=>{
  const genreTitles=visits.flatMap(seed=>['saved','explore'].map(reason=>genreRowTitle('screen','Drama','show',reason as GenreReason,seed)));
  expect(genreTitles.some(title=>/because you|you enjoy|you loved|you watched|you played|you listened|friends/i.test(title))).toBe(false);
  expect(visits.map(seed=>relatedRowTitle('A title','saved',seed)).some(title=>/because you liked|you enjoyed|you loved|you watched|finished/i.test(title))).toBe(false);
});
test('genre aliases read naturally without lowercasing R&B',()=>{
  expect(genreRowTitle('game','Role-playing (RPG)','game')).toBe('Explore role-playing games');
  expect(genreRowTitle('screen','Sci-Fi & Fantasy','show')).toBe('Explore science fiction and fantasy shows');
  expect(genreRowTitle('music',' r&b ','album')).toBe('Explore R&B albums');
});
test('related title variants always name the real seed, and popularity never claims live activity',()=>{
  for(const reason of ['liked','watched','saved'] as const){
    const titles=visits.map(seed=>relatedRowTitle('Example title',reason,seed));
    expect(new Set(titles).size).toBe(relatedTitlePatterns[reason].length);
    expect(titles.every(title=>title.includes('Example title'))).toBe(true);
  }
  for(const medium of ['screen','game','music'] as const){
    const titles=visits.map(seed=>popularRowTitle(medium,seed));
    expect(new Set(titles).size).toBe(3);
    expect(titles.every(title=>/popular/i.test(title)&&title.includes('friends'))).toBe(true);
    expect(titles.some(title=>/watching|playing|listening|right now|today/i.test(title))).toBe(false);
  }
});
