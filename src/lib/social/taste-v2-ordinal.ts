// Small dependency-free proportional-odds model for a single user's sparse ratings.
export type OrderedModel = {levels:number[]; thresholds:number[]; coefficients:Record<string,number>};
export type OrderedObservation = {indices:number[]; values:number[]; rating:number; mass:number};
const sigmoid = (v:number) => 1/(1+Math.exp(-Math.max(-35,Math.min(35,v))));
export const fromStars = (stars:number) => Math.max(-1,Math.min(1,(stars-3)/(stars>=3?2:2.5)));
export const asFit = (signed:number) => 50+50*Math.max(-1,Math.min(1,signed));

// Composite cumulative-logit likelihood with ordered boundaries, sparse L2-regularised
// content coefficients, and damped updates for correlated title characteristics.
export function fitOrderedRatings(design:OrderedObservation[], vocabulary:string[], levels:number[]):OrderedModel {
  const mass=design.reduce((sum,row)=>sum+row.mass,0);
  const thresholds=levels.slice(0,-1).map(stars=>{
    const lower=design.reduce((s,row)=>s+(row.rating<=stars ? row.mass : 0),0);
    return Math.log((lower+.5)/(mass-lower+.5));
  });
  const coefficients=new Float64Array(vocabulary.length);
  const gradient=new Float64Array(coefficients.length);
  const curvature=new Float64Array(coefficients.length);
  const offsets=thresholds.slice();
  const direction = new Float64Array(coefficients.length);
  const cutDirection = new Float64Array(offsets.length);
  const logits = new Float64Array(design.length);
  const projected = new Float64Array(design.length);
  const logisticLoss = (logit:number, positive:boolean) =>
    Math.max(0,positive ? -logit : logit) + Math.log1p(Math.exp(-Math.abs(logit)));
  // Backtracking prevents simultaneous updates on correlated tags, ubiquitous
  // languages and ordinal boundaries from overshooting the same prediction.
  for (let iteration=0; iteration<55; iteration++) {
    gradient.set(coefficients);
    curvature.fill(1);
    const thresholdsGradient = new Float64Array(offsets.length);
    const thresholdsCurvature = new Float64Array(offsets.length);
    let currentLoss=0;
    for(const coefficient of coefficients) currentLoss+=.5*coefficient*coefficient;
    for(let j=0;j<offsets.length;j++) currentLoss+=.125*(offsets[j]-thresholds[j])**2;
    for (let n=0;n<design.length;n++) {
      const row=design[n];
      let score=0;
      for (let k=0;k<row.indices.length;k++) score+=coefficients[row.indices[k]]*row.values[k];
      logits[n]=score;
      let error=0, precision=0;
      const rowMass = row.mass/offsets.length;
      for (let j=0;j<offsets.length;j++) {
        const logit=score-offsets[j];
        const p=sigmoid(logit);
        const positive=row.rating>levels[j];
        const e=rowMass*(p-Number(positive));
        const h=rowMass*p*(1-p);
        currentLoss+=rowMass*logisticLoss(logit,positive);
        error+=e;
        precision+=h;
        thresholdsGradient[j]-=e;
        thresholdsCurvature[j]+=h;
      }
      for (let k=0;k<row.indices.length;k++) {
        const x=row.values[k], i=row.indices[k];
        gradient[i]+=error*x;
        curvature[i]+=precision*x*x;
      }
    }
    let gain=0;
    for(let i=0;i<coefficients.length;i++) {
      direction[i]=gradient[i]/curvature[i];
      gain+=gradient[i]*direction[i];
    }
    for(let j=0;j<offsets.length;j++) {
      const g=thresholdsGradient[j]+.25*(offsets[j]-thresholds[j]);
      cutDirection[j]=g/(thresholdsCurvature[j]+.25);
      gain+=g*cutDirection[j];
    }
    if(gain<1e-5) break;
    for(let n=0;n<design.length;n++) {
      const row=design[n];
      let change=0;
      for(let k=0;k<row.indices.length;k++) change+=direction[row.indices[k]]*row.values[k];
      projected[n]=change;
    }
    let step=1;
    for(;step>=1/128;step/=2) {
      let loss=0;
      for(let i=0;i<coefficients.length;i++) loss+=.5*(coefficients[i]-step*direction[i])**2;
      const next=offsets.map((v,j)=>v-step*cutDirection[j]);
      if(next.some((v,j)=>j>0 && v<=next[j-1])) continue;
      for(let j=0;j<offsets.length;j++) loss+=.125*(next[j]-thresholds[j])**2;
      for(let n=0;n<design.length;n++) {
        const row=design[n], nextLogit=logits[n]-step*projected[n];
        for(let j=0;j<next.length;j++) loss+=row.mass/next.length*logisticLoss(nextLogit-next[j],row.rating>levels[j]);
      }
      if(loss>currentLoss-1e-4*step*gain) continue;
      for(let i=0;i<coefficients.length;i++) coefficients[i]-=step*direction[i];
      for(let j=0;j<offsets.length;j++) offsets[j]=next[j];
      break;
    }
    if(step<1/128) break;
  }
  return {levels,thresholds:offsets,coefficients:Object.fromEntries(vocabulary.map((key,i)=>[key,coefficients[i]]))};
}

export function orderedValue(model:OrderedModel,latent:number) {
  let score=fromStars(model.levels[0]);
  for(let i=0;i<model.thresholds.length;i++) {
    score+=sigmoid(latent-model.thresholds[i])*(fromStars(model.levels[i+1])-fromStars(model.levels[i]));
  }
  return asFit(score);
}
