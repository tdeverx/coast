/** A personal fit is an ordered strength scale. Fit a single monotone mapping
 * from out-of-sample personal predictions to the viewer's actual star utilities. */
// With 50+ direct ratings, train each inner profile on three quarters of the
// history. Four grouped fits limit background cost and avoid smaller half-history
// profiles whose score distributions differ materially from the full model.
export const tasteV2DisplayFoldCount=4;
export type DisplayPoint = {raw:number; stars:number};
type Knot = [raw:number, fit:number];
export type TasteV2Display = {knots:Knot[]; works:number};

function starFit(stars:number) {
  if(stars<=3) return Math.max(0,50*(stars-.5)/2.5);
  if(stars<=4) return 50+30*(stars-3);
  return 80+20*(stars-4);
}

export function fitTasteV2Display(points:readonly DisplayPoint[]):TasteV2Display|undefined {
  const eligible=points.filter(p=>Number.isFinite(p.raw) && p.raw>=0 && p.raw<=100 && Number.isFinite(p.stars) && p.stars>=0 && p.stars<=5);
  if(eligible.length<50 || eligible.filter(p=>p.stars===5).length<8 || eligible.filter(p=>p.stars<=3).length<8) return;
  const knots:Knot[]=[[0,0],[50,50],[100,100]];
  for(const [left,right] of [[0,50],[50,100]]) {
    const rows=eligible.filter(p=>p.raw>left && p.raw<right).sort((a,b)=>a.raw-b.raw);
    if(rows.length<32) continue;
    const n=rows.length;
    const mean=rows.reduce((s,p)=>s+p.raw,0)/n;
    const offset=rows.reduce((s,p)=>s+starFit(p.stars)-p.raw,0)/n;
    const variance=rows.reduce((s,p)=>s+(p.raw-mean)**2,0)/n;
    const low=rows[Math.floor(.05*(n-1))].raw, high=rows[Math.ceil(.95*(n-1))].raw;
    if(high-low<4 || variance<1) continue;
    const covariance=rows.reduce((s,p)=>s+(p.raw-mean)*(starFit(p.stars)-p.raw-offset),0);
    // Twelve ordinary observations' worth of slope shrinkage, toward the identity.
    const slope=Math.max(.1,1+covariance/((n+12)*variance));
    const fit=(raw:number)=>Math.max(left,Math.min(right,mean+offset+slope*(raw-mean)));
    const a=fit(low), b=fit(high);
    if(b<=a || a<=left || b>=right) continue;
    knots.push([low,a],[high,b]);
  }
  return knots.length>3 ? {knots:knots.sort((a,b)=>a[0]-b[0]),works:eligible.length} : undefined;
}

export function applyTasteV2Display(display:TasteV2Display|undefined, score:number):number {
  if(!display) return score;
  for(let i=1;i<display.knots.length;i++) {
    const [right,high]=display.knots[i];
    if(score>right) continue;
    const [left,low]=display.knots[i-1];
    return low+(score-left)*(high-low)/(right-left);
  }
  return 100;
}

/** Assign connected franchise members together. Model training never uses these
 * hashes as title features. Ratings and playback actions do not affect fold membership. */
export function tasteV2DisplayFolds(rows:readonly {work:{id:string};features:{franchises?:{id:string}[]}}[]):Map<string,number> {
  const parents=new Map<string,string>();
  function root(key:string) {
    let next=parents.get(key);
    while(next!==undefined) {
      key=next;
      next=parents.get(key);
    }
    return key;
  }
  for(const r of rows) {
    for(const f of r.features.franchises??[]) {
      const a=root('w:'+r.work.id), b=root('f:'+f.id);
      if(a!==b) parents.set(a>b?a:b,a>b?b:a);
    }
  }
  const folds=new Map<string,number>();
  for(const r of rows) {
    const key=root('w:'+r.work.id);
    let hash=2166136261;
    for(let i=0;i<key.length;i++) hash=Math.imul(hash^key.charCodeAt(i),16777619);
    folds.set(r.work.id,(hash>>>0)%tasteV2DisplayFoldCount);
  }
  return folds;
}
