import { ZipReader, ZipWriter, BlobReader, BlobWriter, type FileEntry } from '@zip.js/zip.js';

const MiB=1024**2;
const maximumExpanded=256*MiB;

/** Count actual decoder output before retaining it, including metadata documents. */
export async function extractEpubEntry(entry:Pick<FileEntry,'getData'>,signal:AbortSignal,budget:{used:number},limit=32*MiB) {
  let size=0;
  const chunks:Uint8Array<ArrayBuffer>[]=[];
  await entry.getData(new WritableStream<Uint8Array>({write(chunk){
    signal.throwIfAborted();
    if(chunk.byteLength>limit-size||chunk.byteLength>maximumExpanded-budget.used)throw new Error('This EPUB archive is too large.');
    size+=chunk.byteLength;budget.used+=chunk.byteLength;
    chunks.push(new Uint8Array(chunk));
  }}),{signal,useWebWorkers:false,checkSignature:true});
  return new Blob(chunks);
}

/** EPUB.js receives a stored archive built only from bounded, verified extraction output. */
export async function prepareEpubArchive(blob:Blob,signal:AbortSignal,inspect:(readDocument:(path:string)=>Promise<string>)=>Promise<void>) {
  signal.throwIfAborted();
  if(blob.size>128*MiB)throw new Error('EPUB files must be smaller than 128 MB.');
  const archive=new ZipReader(new BlobReader(blob));
  let writer:ZipWriter<Blob>|undefined;
  try {
    const entries=new Map<string,FileEntry>(),metadata=new Map<string,Blob>(),budget={used:0};
    let count=0,declared=0;
    for await(const entry of archive.getEntriesGenerator()){
      signal.throwIfAborted();declared+=entry.uncompressedSize;
      if(++count>10000||declared>maximumExpanded||entry.uncompressedSize>32*MiB)throw new Error('This EPUB archive is too large.');
      if(entry.directory)continue;
      const name=entry.filename;
      if(name.length>1024||name.startsWith('/')||name.includes('\\')||/[\u0000-\u001f:]/.test(name)||name.split('/').some(part=>part==='.'||part==='..'))throw new Error('This EPUB has an invalid archive path.');
      if(entries.has(name))throw new Error('This EPUB has duplicate archive entries.');
      entries.set(name,entry);
    }
    await inspect(async path=>{
      const entry=entries.get(path);
      if(!entry||entry.uncompressedSize>2*MiB)throw new Error('This EPUB has an invalid package.');
      const file=metadata.get(path)??await extractEpubEntry(entry,signal,budget,2*MiB);
      metadata.set(path,file);
      return file.text();
    });
    writer=new ZipWriter(new BlobWriter(),{level:0,useWebWorkers:false});
    for(const [name,entry] of entries){
      signal.throwIfAborted();
      const file=metadata.get(name)??await extractEpubEntry(entry,signal,budget);
      await writer.add(name,new BlobReader(file),{level:0,signal});
    }
    const verified=await writer.close();writer=undefined;
    signal.throwIfAborted();
    return verified.arrayBuffer();
  } finally {
    await writer?.close().catch(()=>{});
    await archive.close();
  }
}
