import type { ChartDatum } from './types';
import type { ChartModel, ChartRow } from './model';

type Distribution = { label:string; items:ChartDatum[]; unit?:string; centre?:string; centreLabel?:string; showLegend?:boolean };
type Bars = { label:string; items:ChartDatum[]; summary?:string; caption?:string; axis?:boolean; empty?:string };
function model(title:string,styleId:string,rows:ChartRow[],unit=''):ChartModel {
  const maximum=Math.max(1,...rows.flatMap(row=>[row.value??0,row.reference??0,row.capacity??0]));
  return {id:title,styleId,title,subtitle:'',unit,notes:[],labels:rows.map(row=>row.label),rows,
    series:[],points:[],events:[],flows:[],matrix:[],domain:[0,maximum],domainY:[0,maximum],
    ticks:[0,maximum],ticksY:[],xLabel:'',yLabel:unit,raw:{}};
}
/** Real query results only. These adapters never read the reference fixture catalogue. */
export function barModel(input:Bars):ChartModel {
  const result=model(input.label,input.axis?'2B':'2A',input.items.map(row=>({...row})), '');
  result.subtitle=[input.summary,input.caption].filter(Boolean).join(' · ');
  result.series=[{name:input.label,values:result.rows.map(row=>row.value)}];
  result.raw={empty:input.empty??'No activity yet.'};
  return result;
}
export function distributionModel(input:Distribution):ChartModel {
  const result=model(input.label,'3A',input.items.map(row=>({...row})),input.unit);
  result.raw={center:input.centre,centerLabel:input.centreLabel??input.unit,showLegend:input.showLegend??true};
  return result;
}
export function targetModel(input:{label:string;items:{label:string;value:number;total?:number;href?:string}[]}):ChartModel {
  const result=model(input.label,'11A',input.items.map(row=>({label:row.label,value:row.value,capacity:row.total,reference:row.total,href:row.href})));
  result.raw={referenceLabel:'Total'};
  return result;
}
