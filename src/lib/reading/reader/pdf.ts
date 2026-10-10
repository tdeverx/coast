import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ReaderEngine, ReaderOptions } from './engine';
import { readerLoad } from './engine';
GlobalWorkerOptions.workerSrc=workerUrl;
export async function pdfReader({host,source,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 const data=typeof source==='string'?{url:source,withCredentials:true}:{data:new Uint8Array(await readerLoad(source.arrayBuffer(),signal))};
 signal.throwIfAborted();
 const loading=getDocument({...data,maxImageSize:32*1024**2,enableXfa:false});
 let canvas:HTMLCanvasElement|undefined;
 const abort=()=>{void loading.destroy();};signal.addEventListener('abort',abort,{once:true});
 try {const document=await readerLoad(loading.promise,signal);if(document.numPages>100000)throw new Error('This PDF has too many pages.');
 const pageCanvas=canvas=window.document.createElement('canvas');pageCanvas.setAttribute('aria-label','Reading page');host.replaceChildren(pageCanvas);
 let page=location?.format==='pdf'?Math.min(location.page,document.numPages):1,epoch=0;
 let task:ReturnType<Awaited<ReturnType<typeof document.getPage>>['render']>|undefined;
 async function render(next:number){
  const revision=++epoch;task?.cancel();page=Math.max(1,Math.min(document.numPages,next));
  const item=await document.getPage(page);if(signal.aborted||revision!==epoch){item.cleanup();return;}
  const natural=item.getViewport({scale:1}),ratio=Math.min(window.devicePixelRatio||1,2);
  const scale=Math.min(Math.max(host.clientWidth-32,100)/natural.width,Math.max(host.clientHeight-16,100)/natural.height,2);
  const viewport=item.getViewport({scale:scale*ratio});pageCanvas.width=viewport.width;pageCanvas.height=viewport.height;
  pageCanvas.style.width=`${viewport.width/ratio}px`;pageCanvas.style.height=`${viewport.height/ratio}px`;
  const context=pageCanvas.getContext('2d')!;task=item.render({canvas:pageCanvas,canvasContext:context,viewport});
  try{await task.promise;if(revision===epoch&&!signal.aborted)changed({format:'pdf',page,total:document.numPages});}catch(error){if((error as Error).name!=='RenderingCancelledException')throw error;}finally{item.cleanup();}
 }
 await render(page);
 return {previous:()=>render(page-1),next:()=>render(page+1),go:target=>render(target.format==='pdf'?target.page:page),resize:()=>render(page),destroy(){epoch++;task?.cancel();signal.removeEventListener('abort',abort);void loading.destroy();pageCanvas.remove();}};
 }catch(cause){signal.removeEventListener('abort',abort);canvas?.remove();await loading.destroy();throw cause;}
}
