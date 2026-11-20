import {expect,test} from 'bun:test';
import {sectionTarget} from '../src/lib/ui/section-target';
const base=new URL('https://coast.invalid/for-you');
const source=(href:string)=>{const target=sectionTarget(href,base);return target&&'source' in target?target.source:undefined;};
test('linked row targets preserve source identity and selections across media',()=>{
 expect(source('/progress?view=watching&category=reading&kind=comic&scope=available')).toMatchObject({type:'progress',filters:{view:'watching',category:'reading',kind:'comic',scope:'available'}});
 expect(source('/library?view=read&collection=true&kind=comic&username=alice')).toMatchObject({type:'library',surface:'read',collection:true,initialKind:'comic',username:'alice'});
 expect(source('/for-you?section=dynamic&genre=Drama&seed=stable&reason=liked')).toMatchObject({type:'recommendation',feature:'row',genre:'Drama',seed:'stable',reason:'liked'});
 expect(source('/for-you?section=activity&category=music')).toMatchObject({type:'social',category:'music'});
 expect(source('/discover?section=recent&surface=read&kind=book')).toMatchObject({type:'discovery',section:'recent',surface:'read',kind:'book'});
 expect(source('/discover?section=browse&view=play&variant=provider-rated&kind=game&seed=row')).toMatchObject({type:'recommendation',mode:'generic',feature:'browse',category:'game',variant:'provider-rated',kind:'game',seed:'row'});
 expect(source('/for-you?section=browse&view=watch&variant=provider-genre&genre=scifi&kind=movie')).toMatchObject({type:'recommendation',mode:'personal',feature:'browse',category:'screen',genre:'scifi'});
 expect(source('/music?kind=album')).toMatchObject({type:'library',surface:'listen',initialSelection:'album'});
 expect(source('/games?state=in-progress&personal=true')).toMatchObject({type:'library',surface:'play',initialSelection:'in-progress',collection:true});
 expect(source('/profile/alice?section=progress&category=reading&view=paused&kind=comic&page=2')).toMatchObject({type:'progress-experiment',username:'alice',title:'Reading',profile:true,filters:{category:'reading',view:'paused',kind:'comic',page:2}});
 expect(source('/profile/alice?section=list&list=watchlist&scope=available&page=3')).toMatchObject({type:'list',view:'watchlist',profile:'alice',page:3,filters:{scope:'available'}});
 expect(source('/lists?view=watchlist')).toMatchObject({type:'list',view:'watchlist'});
 expect(source('/progress?view=watchlist&category=music&scoped=true')).toMatchObject({type:'progress',actionScoped:true,category:'music',mediums:false});
 expect(source('/for-you?section=requests&view=watch')).toMatchObject({type:'library-feed',feature:'requests'});
 expect(source('/for-you?section=activity&view=watch&audience=friends&mediaKind=movie&period=month&activityType=ratings')).toMatchObject({type:'social',audience:'friends',mediaKind:'movie',period:'month',activityType:'ratings'});
 expect(source('/for-you?section=activity&view=watch&audience=public')).toBeUndefined();
 expect(source('/for-you?section=activity&view=watch&audience=all')).toMatchObject({type:'social',audience:'all'});
 expect(source('/for-you?section=requests&view=listen')).toBeUndefined();
});
test('unrelated, action and unsafe destinations cannot become row views',()=>{
 for(const href of ['/settings','/for-you','/profile/alice','/lists','/discover','/progress?view=invalid','/library?view=invalid','/for-you?section=activity&category=invalid','/progress?action=delete','/progress?view=watching&view=next','/progress#activity','https://elsewhere.invalid/progress','https://user:secret@coast.invalid/progress'])expect(sectionTarget(href,base)).toBeNull();
 expect(sectionTarget('/discover?section=browse&variant=unknown&kind=movie',base)).toBeNull();
});
test('profile row links reject invalid media and page selectors',()=>{
 expect(sectionTarget('/profile/alice?section=progress&category=invalid',base)).toBeNull();
 expect(sectionTarget('/profile/alice?section=list&list=watchlist&page=0',base)).toBeNull();
});
