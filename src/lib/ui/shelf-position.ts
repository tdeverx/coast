/** Small DOM positions only: no card payloads, height cache or retained document nodes in history. */
export type ShelfPosition = { key:string; offset:number; focusKey?:string; focus?:number };

export function shelfScrollOwner(node:HTMLElement):HTMLElement {
  for(let parent=node.parentElement;parent;parent=parent.parentElement)
    if(parent.hasAttribute('data-shelf-scroll')||/auto|scroll/.test(getComputedStyle(parent).overflowY))return parent;
  return document.scrollingElement as HTMLElement;
}

export function captureShelfPosition(node:HTMLElement,layout:'row'|'grid',keys?:readonly string[]):ShelfPosition|undefined {
  const owner=layout==='row'?node:shelfScrollOwner(node),bounds=owner.getBoundingClientRect();
  const edge=layout==='row'?bounds.left:Math.max(0,bounds.top);
  const end=layout==='row'?bounds.right:Math.min(innerHeight,bounds.bottom);
  const admitted=keys?new Set(keys):undefined;
  const cards=[...node.querySelectorAll<HTMLElement>('[data-shelf-key]')];
  const card=cards.find(card=>{
    if(admitted&&!admitted.has(card.dataset.shelfKey!))return false;
    const rect=card.getBoundingClientRect();
    return layout==='row'?rect.right>edge&&rect.left<end:rect.bottom>edge&&rect.top<end;
  });
  if(!card)return;
  const rect=card.getBoundingClientRect();
  const focused=document.activeElement?.closest<HTMLElement>('[data-shelf-key]');
  const focusCard=focused&&node.contains(focused)?focused:undefined;
  const controls=focusCard?[...focusCard.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]:[];
  const focus=controls.indexOf(document.activeElement as HTMLElement);
  return {key:card.dataset.shelfKey!,offset:(layout==='row'?rect.left:rect.top)-edge,...(focus>=0?{focusKey:focusCard!.dataset.shelfKey!,focus}:{})};
}

export function restoreShelfPosition(node:HTMLElement,layout:'row'|'grid',position:ShelfPosition,focus=false) {
  const card=[...node.querySelectorAll<HTMLElement>('[data-shelf-key]')].find(card=>card.dataset.shelfKey===position.key);
  if(!card)return false;
  const owner=layout==='row'?node:shelfScrollOwner(node),bounds=owner.getBoundingClientRect(),rect=card.getBoundingClientRect();
  if(layout==='row')owner.scrollLeft+=rect.left-bounds.left-position.offset;
  else owner.scrollTop+=rect.top-Math.max(0,bounds.top)-position.offset;
  if(focus&&position.focus!==undefined) {
    const focusCard=[...node.querySelectorAll<HTMLElement>('[data-shelf-key]')].find(card=>card.dataset.shelfKey===position.focusKey)??card;
    const controls=focusCard.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]');
    (controls[position.focus]??controls[0])?.focus({preventScroll:true});
  }
  return true;
}
