import { ReadingHash } from './hash';
self.onmessage=async(event:MessageEvent<File>)=>{
 try{const hash=new ReadingHash(),stream=event.data.stream().getReader();try{while(true){const chunk=await stream.read();if(chunk.done)break;hash.update(chunk.value);}}finally{stream.releaseLock();}self.postMessage({digest:hash.digest()});}
 catch{self.postMessage({error:'This reading file could not be identified.'});}
};
