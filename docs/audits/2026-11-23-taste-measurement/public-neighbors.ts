// Research only. Fit item-to-item similarities solely from ratings before the replay cutoff.
type Rating = number[];
const logistic = (value:number) => 1 / (1 + Math.exp(-value));

export function neighborhood(earlier:Rating[], itemCount:number) {
  const users = new Map<number, Rating[]>();
  const items = new Map<number, Rating[]>();
  for (const row of earlier) {
    const [user,item] = row;
    if (!users.has(user)) users.set(user,[]);
    if (!items.has(item)) items.set(item,[]);
    users.get(user)!.push(row);
    items.get(item)!.push(row);
  }
  const population = (1 + earlier.filter(r=>r[2]>=4).length) / (earlier.length+2);
  const intercept = Math.log(population / (1-population));
  const userBias = new Map<number,number>(), itemBias = new Map<number,number>();
  function probability(u:number,i:number) {
    return logistic(intercept + (userBias.get(u)??0) + (itemBias.get(i)??0));
  }
  function fitBias(groups:Map<number,Rating[]>, bias:Map<number,number>) {
    for (const [key,observations] of groups) {
      const current = bias.get(key)??0;
      let gradient = -4*current, curvature = 4;
      for (const [u,i,stars] of observations) {
        const p=probability(u,i);
        gradient+=Number(stars>=4)-p;
        curvature+=p*(1-p);
      }
      bias.set(key,current+gradient/curvature);
    }
  }
  for (let pass=0;pass<12;pass++) {
    fitBias(users,userBias);
    fitBias(items,itemBias);
  }
  // Store one triangle. Accumulate the two norms over the same co-rating population.
  const size=itemCount*(itemCount+1)/2;
  const overlap=new Uint32Array(size), dot=new Float64Array(size);
  const normLow=new Float64Array(size), normHigh=new Float64Array(size);
  function key(low:number,high:number) {return high*(high-1)/2+low-1;}
  for (const [u,ratings] of users) {
    const entries=ratings.map(([,i,r])=>[i,Number(r>=4)-probability(u,i)]).sort((a,b)=>a[0]-b[0]);
    for (let b=1;b<entries.length;b++) {
      const [high,rh]=entries[b];
      for (let a=0;a<b;a++) {
        const [low,rl]=entries[a], k=key(low,high);
        overlap[k]++; dot[k]+=rl*rh; normLow[k]+=rl*rl; normHigh[k]+=rh*rh;
      }
    }
  }
  return function predict(u:number,i:number) {
    const neighbors=[];
    for (const [,j,stars] of users.get(u)??[]) {
      if (j===i) throw Error('A held-out title already has a personal training rating.');
      const k=key(Math.min(i,j),Math.max(i,j)), n=overlap[k];
      if(n<5 || !normLow[k] || !normHigh[k])continue;
      const similarity=dot[k]/Math.sqrt(normLow[k]*normHigh[k])*n/(n+30);
      if(similarity>0)neighbors.push({weight:similarity,residual:Number(stars>=4)-probability(u,j),id:j});
    }
    neighbors.sort((a,b)=>b.weight-a.weight||a.id-b.id);
    let correction=0, weight=1;
    for(const neighbor of neighbors.slice(0,20)){
      correction+=neighbor.weight*neighbor.residual;
      weight+=neighbor.weight;
    }
    const base=probability(u,i);
    return {bias:100*base,neighbors:100*Math.max(.01,Math.min(.99,base+correction/weight)),support:Math.min(neighbors.length,20)};
  };
}
