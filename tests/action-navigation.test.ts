import {expect,test} from 'bun:test';
import {actionHref} from '../src/lib/actions';
const source=await Bun.file('src/lib/ui/components/Header.svelte').text();
const functionSource=source.slice(source.indexOf('  async function chooseAction('),source.indexOf('  reportFailure(()=>actionError)'));
const hook=source.split('\n').find(line=>line.includes('beforeNavigate(navigation =>'));
if(!hook)throw Error('Action navigation must observe newer route intent');
const compiled=new Bun.Transpiler({loader:'ts'}).transformSync(functionSource);
function fixture(){
 let release!:()=>void;const saving=new Promise<void>(resolve=>release=resolve),paths:string[]=[];
 const page={url:new URL('http://coast/search?view=read&q=Batman')},navigating={to:{url:new URL('http://coast/search?view=read&q=Superman')}};
 const factory=new Function('page','navigating','api','goto','actionHref',`let changingAction=false,actionError='',actionRequest,actionNavigation=0,user={username:'actual-owner'},preview=false,action='read',onNavigate;const beforeNavigate=callback=>onNavigate=callback;${hook}${compiled};return {chooseAction,navigate(url){onNavigate({shallow:false});navigating.to={url:new URL(url)}},account(){user={username:'other-owner'}}};`);
 const owner=factory(page,navigating,()=>saving,async(path:string)=>{paths.push(path);},actionHref);
 return{owner,page,paths,release};
}
test('action selection preserves an entering Search query across an older settings refresh',async()=>{
 const f=fixture(),pending=f.owner.chooseAction('listen');f.page.url=new URL('http://coast/search?view=read&q=Batman');f.release();await pending;
 expect(f.paths).toEqual(['/search?view=listen&q=Superman']);
});
test('a newer main-page navigation wins while action settings are saving',async()=>{
 const f=fixture(),pending=f.owner.chooseAction('listen');f.owner.navigate('http://coast/library?view=read&page=4');f.release();await pending;
 expect(f.paths).toEqual(['/library?view=listen']);
});
test('an account change cannot publish the previous actor action navigation',async()=>{
 const f=fixture(),pending=f.owner.chooseAction('listen');f.owner.account();f.release();await pending;expect(f.paths).toEqual([]);
});
