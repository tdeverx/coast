import {expect,test} from 'bun:test';
import {editionChoices,namedEdition} from '../src/lib/media/editions';
import {editionSnapshot} from '../src/lib/media/edition-metadata';
import {resolveMetadata} from '../src/lib/catalogue/metadata/resolve';
test('edition tabs collapse technical variants while preserving named cuts',()=>{
 const choices=editionChoices(['1080p H264 AAC','2160p HEVC HDR10','Titanic - Director’s Cut - 1080p','Titanic - Director\'s Cut - 2160p HDR','Extended Edition 1080p','Extended Edition 4K','Some release group'],'Titanic');
 expect(choices).toEqual([{value:'theatrical',label:'Theatrical'},{value:'directors cut',label:'Director\'s Cut'},{value:'extended edition',label:'Extended Edition'}]);
 expect(namedEdition('Titanic (1997) - 1080p','Titanic')?.value).toBe('theatrical');
 expect(namedEdition('mkv','Titanic')?.value).toBe('theatrical');
 expect(namedEdition('Unidentified label','Titanic')).toEqual({value:'theatrical',label:'Theatrical'});
 expect(namedEdition('597} [Bluray-1080p][DTS-HD MA 5.1][h264]-DTS','Titanic')).toEqual({value:'theatrical',label:'Theatrical'});
});
test('explicit edition markers retain custom edition names and never accept technical variants as cuts',()=>{
 expect(namedEdition('Titanic {edition-Festival Preview} 1080p','Titanic')).toEqual({value:'festival preview',label:'Festival Preview'});
 expect(namedEdition('IMAX 2160p','Titanic')).toEqual({value:'imax',label:'IMAX'});
 expect(editionChoices(['1080p','4K','mp4','Theatrical Cut'],'Titanic')).toEqual([{value:'theatrical',label:'Theatrical'}]);
});
test('edition metadata fills missing fields from the shared title and preserves preferences and administrator locks',()=>{
 const snapshot=editionSnapshot({title:'Extended title',overview:'Extended synopsis',genres:[],backdropPath:'',runtimeMinutes:194,certificate:'15'},12540);
 expect(snapshot.runtimeMinutes).toBe(209);
 const input={fallback:{title:'Shared title',genres:['Drama'],backdropPath:'/shared.jpg'},snapshots:[{...snapshot,provider:'jellyfin',updatedAt:new Date()}],user:{title:'My title',posterPath:'/personal.jpg'},override:{overview:'Admin synopsis'}};
 expect(resolveMetadata(input).values).toMatchObject({title:'My title',overview:'Admin synopsis',posterPath:'/personal.jpg',backdropPath:'/shared.jpg',genres:['Drama'],runtimeMinutes:209});
 expect(resolveMetadata({...input,locks:['title'],override:{title:'Locked title'}}).values.title).toBe('Locked title');
 expect(editionSnapshot({title:42,genres:['Drama',null,8],runtimeMinutes:-1},0)).toEqual({genres:['Drama']});
});
