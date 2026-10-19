import {getContext,setContext} from 'svelte';

export type Retain = () => () => void;
const key=Symbol('Retained UI owner');
const idle:Retain=()=>()=>{};

/** Capture during component initialization; continuations never consult component context. */
export function useRetention():Retain { return getContext<Retain|undefined>(key)??idle; }

/** Nested cards/actions also retain their containing card until every owner releases. */
export function provideRetention(acquire:Retain):Retain {
  const parent=useRetention();
  const retain=()=>{
    const releaseParent=parent(),release=acquire();let active=true;
    return ()=>{if(!active)return;active=false;release();releaseParent();};
  };
  setContext(key,retain);
  return retain;
}
