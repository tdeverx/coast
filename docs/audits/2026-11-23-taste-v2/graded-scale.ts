// Independent nested-fit display check. The inner records were predicted without the outer targets.
import {writeFile} from 'node:fs/promises';
import {applyTasteV2Display,fitTasteV2Display,type DisplayPoint} from '../../../src/lib/social/taste-v2-display';
const [source,out]=Bun.argv.slice(2);
if(!source||!out)throw Error('Supply nested fits from scale or dated-scale and a new private destination.');
type Target={group:string;scores:Record<string,number|null>};
type Study={
  manifest:unknown;version:number;scales:{medium:string;split:string;group:string;train:DisplayPoint[]}[];
  runs:{medium:string;split:string;budget:string;targets:Target[]}[];
};
const {scales,...report}:Study=await Bun.file(source).json();
const key=(medium:string,split:string,group:string)=>[medium,split,group].join('/');
const fits=new Map(scales.map(s=>[key(s.medium,s.split,s.group),fitTasteV2Display(s.train)]));
for(const r of report.runs)for(const t of r.targets){
  const fit=fits.get(key(r.medium,r.split,t.group)),raw=t.scores.balanced;
  t.scores.graded=raw===null?null:Math.round(applyTasteV2Display(fit,raw));
}
await writeFile(out,JSON.stringify(report),{flag:'wx',mode:0o600});
