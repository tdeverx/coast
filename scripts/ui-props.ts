import ts from 'typescript';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type PreviewProp = {
  name:string; type:string; optional:boolean; bindable:boolean;
  kind:'text'|'number'|'boolean'|'select'|'data'|'snippet'|'callback';
  nullable:boolean; choices?:Array<string|number>; defaultSource?:string; defaultValue?:unknown;
};
const files=new Map<string,ts.SourceFile>();
function source(path:string) {
  const cached=files.get(path);if(cached)return cached;
  const text=readFileSync(path,'utf8');
  const script=path.endsWith('.svelte')?[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'):text;
  const result=ts.createSourceFile(path,script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);files.set(path,result);return result;
}
function imported(file:ts.SourceFile,name:string) {
  for(const node of file.statements)if(ts.isImportDeclaration(node)&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)) {
    const item=node.importClause.namedBindings.elements.find(item=>item.name.text===name);if(!item)continue;
    const specifier=(node.moduleSpecifier as ts.StringLiteral).text;
    if(!specifier.startsWith('.')&&!specifier.startsWith('#lib/'))continue;
    const base=specifier.startsWith('#lib/')?resolve('src/lib',specifier.slice(5)):resolve(dirname(file.fileName),specifier);
    const path=[base,base.replace(/\.js$/,'.ts'),`${base}.ts`,`${base}.svelte.ts`,`${base}.svelte`,`${base}/index.ts`].find(path=>existsSync(path)&&statSync(path).isFile());
    if(path)return {file:source(path),name:(item.propertyName??item.name).text};
  }
}
function alias(file:ts.SourceFile,name:string):ts.TypeNode|undefined {
  return file.statements.find((node):node is ts.TypeAliasDeclaration=>ts.isTypeAliasDeclaration(node)&&node.name.text===name)?.type;
}
function members(node:ts.TypeNode|undefined,file:ts.SourceFile):ts.PropertySignature[] {
  if(!node)return [];
  if(ts.isTypeLiteralNode(node))return node.members.filter(ts.isPropertySignature);
  if(ts.isUnionTypeNode(node)||ts.isIntersectionTypeNode(node))return node.types.flatMap(node=>members(node,file));
  if(ts.isParenthesizedTypeNode(node))return members(node.type,file);
  if(ts.isTypeReferenceNode(node))return members(alias(file,node.typeName.getText(file)),file);
  return [];
}
type Description=Pick<PreviewProp,'kind'|'nullable'|'choices'>;
function describe(node:ts.TypeNode|undefined,file:ts.SourceFile,depth=0):Description {
  if(!node||depth>5)return {kind:'data',nullable:false};
  if(ts.isParenthesizedTypeNode(node))return describe(node.type,file,depth+1);
  if(ts.isFunctionTypeNode(node))return {kind:'callback',nullable:false};
  if(/^(?:import\('svelte'\)\.)?Snippet\b/.test(node.getText(file)))return {kind:'snippet',nullable:false};
  if(node.kind===ts.SyntaxKind.StringKeyword)return {kind:'text',nullable:false};
  if(node.kind===ts.SyntaxKind.NumberKeyword)return {kind:'number',nullable:false};
  if(node.kind===ts.SyntaxKind.BooleanKeyword)return {kind:'boolean',nullable:false};
  if(ts.isLiteralTypeNode(node)) {
    if(node.literal.kind===ts.SyntaxKind.NullKeyword)return {kind:'data',nullable:true};
    if(node.literal.kind===ts.SyntaxKind.TrueKeyword||node.literal.kind===ts.SyntaxKind.FalseKeyword)return {kind:'boolean',nullable:false};
    if(ts.isStringLiteral(node.literal)||ts.isNumericLiteral(node.literal))return {kind:'select',nullable:false,choices:[ts.isNumericLiteral(node.literal)?Number(node.literal.text):node.literal.text]};
  }
  if(ts.isUnionTypeNode(node)) {
    const parts=node.types.map(node=>describe(node,file,depth+1)),values=parts.filter(part=>!part.nullable);
    const nullable=parts.some(part=>part.nullable);
    if(values.length&&values.every(part=>part.kind==='select'))return {kind:'select',nullable,choices:[...new Set(values.flatMap(part=>part.choices??[]))]};
    return {...(values[0]??parts[0]),nullable};
  }
  if(ts.isTypeReferenceNode(node)) {
    const name=node.typeName.getText(file),local=alias(file,name);
    if(local)return describe(local,file,depth+1);
    const target=imported(file,name);if(target)return describe(alias(target.file,target.name),target.file,depth+1);
  }
  if(ts.isTypeOperatorNode(node)&&node.operator===ts.SyntaxKind.KeyOfKeyword&&ts.isTypeQueryNode(node.type)) {
    const [name,...path]=node.type.exprName.getText(file).split('.');
    for(const statement of file.statements)if(ts.isVariableStatement(statement))for(const variable of statement.declarationList.declarations) {
      if(variable.name.getText(file)!==name||!variable.initializer)continue;
      let initial:ts.Expression=ts.isAsExpression(variable.initializer)?variable.initializer.expression:variable.initializer;
      for(const key of path) {
        if(!ts.isObjectLiteralExpression(initial))break;
        const property=initial.properties.find(prop=>prop.name?.getText(file)===key);
        if(!property||!ts.isPropertyAssignment(property))break;
        initial=property.initializer;
      }
      if(ts.isObjectLiteralExpression(initial))return {kind:'select',nullable:false,choices:initial.properties.map(prop=>prop.name?.getText(file).replace(/^['"]|['"]$/g,'')).filter((value):value is string=>!!value)};
    }
  }
  return {kind:'data',nullable:false};
}
function literal(expression:ts.Expression|undefined):unknown {
  if(!expression)return undefined;
  if(ts.isCallExpression(expression)&&expression.expression.getText()==='$bindable')return literal(expression.arguments[0]);
  if(ts.isStringLiteral(expression))return expression.text;
  if(ts.isNumericLiteral(expression))return Number(expression.text);
  if(expression.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(expression.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(expression.kind===ts.SyntaxKind.NullKeyword)return null;
  return undefined;
}
/** Build-time contract extraction. The playground ships JSON, never a TS parser. */
export function previewProps(path:string):PreviewProp[] {
  const file=source(resolve(path)),result:PreviewProp[]=[];
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node)&&node.initializer?.getText(file)==='$props()'&&ts.isObjectBindingPattern(node.name)) {
      const signatures=members(node.type,file);
      for(const binding of node.name.elements) {
        const name=(binding.propertyName??binding.name).getText(file),types=signatures.filter(prop=>prop.name.getText(file).replace(/^['"]|['"]$/g,'')===name);
        const definitions=types.filter(prop=>prop.type?.kind!==ts.SyntaxKind.NeverKeyword).map(prop=>describe(prop.type,file));
        const description=definitions[0]??describe(undefined,file);
        if(description.kind==='boolean'&&definitions.some(part=>part.kind==='boolean'))description.kind='boolean';
        result.push({name,type:types.map(prop=>prop.type?.getText(file)??'unknown').filter((value,index,array)=>array.indexOf(value)===index).join(' | '),optional:types.some(prop=>!!prop.questionToken),bindable:binding.initializer?.getText(file).startsWith('$bindable(')??false,...description,defaultSource:binding.initializer?.getText(file),defaultValue:literal(binding.initializer)});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(file);return result;
}
