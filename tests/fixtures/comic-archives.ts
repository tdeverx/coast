/** Tiny stored RAR4/TAR fixtures authored here; no third-party comic content. */
const encoder=new TextEncoder();
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function rarBlock(type:number,flags:number,payload:Uint8Array){const block=new Uint8Array(7+payload.length),view=new DataView(block.buffer);block[2]=type;view.setUint16(3,flags,true);view.setUint16(5,block.length,true);block.set(payload,7);view.setUint16(0,crc32(block.subarray(2))&65535,true);return block;}
function concat(parts:Uint8Array[]){const result=new Uint8Array(parts.reduce((size,p)=>size+p.length,0));let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;}
export function rarComic(files:Record<string,Uint8Array>){
 const parts:Uint8Array[]=[new Uint8Array([0x52,0x61,0x72,0x21,0x1a,7,0]),rarBlock(0x73,0,new Uint8Array(6))];
 for(const [filename,data] of Object.entries(files)){
  const name=encoder.encode(filename),header=new Uint8Array(25+name.length),view=new DataView(header.buffer);
  view.setUint32(0,data.length,true);view.setUint32(4,data.length,true);header[8]=3;view.setUint32(9,crc32(data),true);header[17]=20;header[18]=0x30;view.setUint16(19,name.length,true);view.setUint32(21,0o100644,true);header.set(name,25);
  parts.push(rarBlock(0x74,0x8000,header),data);
 }
 parts.push(rarBlock(0x7b,0,new Uint8Array()));return concat(parts).buffer;
}
export function tarComic(files:Record<string,Uint8Array>){
 const parts:Uint8Array[]=[];
 for(const [filename,data] of Object.entries(files)){
  const header=new Uint8Array(512);header.set(encoder.encode(filename));
  const field=(offset:number,size:number,value:number)=>header.set(encoder.encode(value.toString(8).padStart(size-1,'0')+'\0'),offset);
  field(100,8,0o644);field(108,8,0);field(116,8,0);field(124,12,data.length);field(136,12,0);header.fill(32,148,156);header[156]=48;header.set(encoder.encode('ustar\0'+'00'),257);
  const checksum=header.reduce((sum,n)=>sum+n,0);header.set(encoder.encode(checksum.toString(8).padStart(6,'0')+'\0 '),148);
  parts.push(header,data,new Uint8Array((512-data.length%512)%512));
 }
 parts.push(new Uint8Array(1024));return concat(parts).buffer;
}
// libarchive/bsdtar-generated 7z: page10.png="page ten", page2.png="page two".
export const sevenComic=()=>Uint8Array.fromBase64('N3q8ryccAAN7WJr8iwAAAAAAAAAhAAAAAAAAAOkB58wAOBhJKsK+DwrZSOCOMcId6f/9K6AAAACBMweuD89dLwwHyEOAg4Fb/6x2z3g/DnZTe62s/WAwgiI9FVtVSZmqO5av9pbgKjKbg95QpLZrKauM9tm+WpnI9qDUar2c1SeBXjQMdN4HV0QTgbpQTazs7LBExp+DBefk6wvyzcgsaYEQQxyed//+giwAFwYWAQl1AAcLAQABIwMBAQVdAACAAAyApAoBZ/OqIgAA').buffer;
