/** Return a rejected hook promise on failure: EPUB.js catches synchronous hook exceptions. */
export async function sanitizeReadingDocument(doc:Document,section?:{unload():void}){
 try {
  const root=doc.documentElement;
  if(!root||root.localName.toLowerCase()!=='html'||root.namespaceURI&&root.namespaceURI!=='http://www.w3.org/1999/xhtml')throw new Error('This EPUB has an unsupported chapter document.');
  for(const node of doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv]'))node.remove();
  for(const node of doc.querySelectorAll('*'))for(const attribute of Array.from(node.attributes)){
    if(/^on/i.test(attribute.name)||attribute.name==='srcdoc'||/^(?:javascript|vbscript):/i.test(attribute.value.trim()))node.removeAttribute(attribute.name);
  }
  let head=Array.from(root.children).find(node=>node.localName==='head'&&node.namespaceURI===root.namespaceURI) as HTMLHeadElement|undefined;
  if(!head)head=doc.createElementNS(root.namespaceURI,'head') as HTMLHeadElement;
  // XML preserves source order: policy must precede every body/resource, even in malformed chapters.
  root.prepend(head);
  const policy=doc.createElementNS(root.namespaceURI,'meta');
  policy.setAttribute('http-equiv','Content-Security-Policy');
  policy.setAttribute('content',"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; base-uri 'none'; form-action 'none'");
  head.prepend(policy);
 }catch(cause){
  // EPUB.js caches contents before content hooks settle. Never reuse a rejected chapter.
  section?.unload();
  throw cause;
 }
}
