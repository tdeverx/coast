/** Personal agreement with independent TMDB comparisons. Equal similarities share the last slots. */
export type AudienceVote = {score:number; votes:number};
export type AudiencePeer = {family:string; similarity:number; stars:number; audience:AudienceVote; predicted:number|null};
type Donor = {weight:number; stars:number; crowd:number; error:number};

export function ratingUtility(stars:number) {
  return stars<=3 ? Math.max(0,20*(stars-.5)) : 50+30*Math.min(1,stars-3)+20*Math.max(0,stars-4);
}
function publicFit({score,votes}:AudienceVote) {
  return 50+(ratingUtility(score/2)-50)*votes/(votes+50);
}
function neighbours(peers:AudiencePeer[], weak:boolean) {
  const result:Donor[]=[], seen=new Set<string>();
  let slots=12;
  for(let start=0;start<peers.length && slots>0;) {
    const similarity=peers[start].similarity, families=new Map<string,AudiencePeer[]>();
    do {
      const p=peers[start++];
      if(seen.has(p.family) || (weak ? p.audience.score>=6 : p.predicted===null)) continue;
      const rows=families.get(p.family);
      if(rows) rows.push(p);
      else families.set(p.family,[p]);
    } while(start<peers.length && peers[start].similarity===similarity);
    if(!families.size) continue;
    const share=Math.min(1,slots/families.size);
    for(const [family,rows] of families) {
      seen.add(family);
      let precision=0, crowd=0, stars=0, error=0;
      for(const row of rows) {
        precision+=row.audience.votes/(row.audience.votes+50);
        crowd+=row.audience.score;
        stars+=row.stars;
        error+=ratingUtility(row.stars)-(weak ? publicFit(row.audience) : row.predicted!);
      }
      const n=rows.length;
      result.push({weight:similarity*share*precision/n,crowd:crowd/n,stars:stars/n,error:error/n});
    }
    slots-=Math.min(slots,families.size);
  }
  return result;
}

/** Only the sign matters here. The magnitude in the replay was capped at eight. */
function agreementPointsDown(audience:AudienceVote,donors:Donor[]) {
  if(donors.length<2) return false;
  const total=donors.reduce((sum,d)=>sum+d.weight,0);
  const center=donors.reduce((sum,d)=>sum+d.weight*d.crowd,0)/total;
  if(audience.score>=center) return false;
  // Sum weighted concordance without comparing every pair in a large tied neighbourhood.
  const sorted=[...donors].sort((a,b)=>a.crowd-b.crowd), prior=new Map<number,number>();
  let concordance=0;
  for(let start=0;start<sorted.length;) {
    let end=start+1;
    while(end<sorted.length && sorted[end].crowd===sorted[start].crowd) end++;
    for(const row of sorted.slice(start,end)) {
      for(const [stars,weight] of prior) concordance+=row.weight*weight*Math.sign(row.stars-stars);
    }
    for(let i=start;i<end;i++) {
      const d=sorted[i];
      prior.set(d.stars,(prior.get(d.stars)??0)+d.weight);
    }
    start=end;
  }
  const error=donors.reduce((sum,d)=>d.crowd<center ? sum+d.weight*d.error : sum,0);
  return concordance>0 && error<0;
}

export function audienceConfirmsDislike(audience:AudienceVote,peers:AudiencePeer[]) {
  if(publicFit(audience)>=50) return false;
  peers.sort((a,b)=>b.similarity-a.similarity);
  if(!agreementPointsDown(audience,neighbours(peers,false))) return false;
  const weak=neighbours(peers,true).sort((a,b)=>a.error-b.error || a.weight-b.weight);
  if(weak.length<2) return false;
  const half=weak.reduce((sum,p)=>sum+p.weight,0)/2;
  let cumulative=0;
  for(let i=0;i<weak.length;i++) {
    cumulative+=weak[i].weight;
    if(cumulative<half) continue;
    const error=cumulative===half ? (weak[i].error+weak[i+1].error)/2 : weak[i].error;
    return publicFit(audience)+error<50;
  }
  return false;
}
