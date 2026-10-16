import {expect,test} from 'bun:test';
import {editable,editableExamples,exampleDefaults,exampleConfiguration} from '../src/routes/ui-preview/workspace';

test('playground drafts are local values and expose only supported component controls',()=>{
  const first=exampleDefaults('Button'),second=exampleDefaults('Button');
  first.text='Changed';
  expect(second.text).toBe('Play');
  expect(editable('Button')).toBe(true);
  expect(editable('JobsSettings')).toBe(false);
  expect(new Set(editableExamples).size).toBe(editableExamples.length);
});

test('component configuration reflects genuine props rather than canvas geometry or invented properties',()=>{
  const values=exampleDefaults('Button');
  Object.assign(values,{text:'Watch',disabled:true,icon:false});
  const button=exampleConfiguration('Button',values,'disabled');
  expect(JSON.parse(JSON.stringify(button))).toEqual({component:'Button',scenario:'disabled',props:{text:'Watch',label:'Watch',emphasis:'standard',size:'standard',disabled:true,danger:false}});
  const progress=exampleConfiguration('ProgressBar',{...values,number:65},'default');
  expect(progress.props).toEqual({progress:0.65});
  expect(exampleConfiguration('Avatar',{...values,number:80},'default').props).toEqual({name:'Watch',size:80});
});

test('media-card configuration includes the complete synthetic item and the selected rendering props',()=>{
  const values={...exampleDefaults('MediaCard'),showCaption:false,shape:'circle' as const};
  const config=exampleConfiguration('MediaCard',values,'default');
  expect(config.props.item).toMatchObject({id:expect.any(String),kind:'movie',title:'The Magicians',poster:'/coast-mark.png'});
  expect(config.props).toMatchObject({shape:'circle',showCaption:false,showPrimaryAction:true});
});
