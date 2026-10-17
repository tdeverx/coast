import {test,expect} from 'bun:test';
import {defaultConfig} from '../src/lib/server/config';
import {featureValues,resolveFeatures,administratorFeatures} from '../src/lib/features';
import {categoryEnabled,mediumOptions} from '../src/lib/experimental';
test('normal defaults preserve behavior and experiments retain independent admission',()=>{
 const values=featureValues(defaultConfig);
 for(const key of administratorFeatures)expect(values[key]).toBe(true);
 for(const key of ['music','game','book','comic','parties','planning','sharing'] as const)expect(values[key]).toBe(false);
 expect(values.requests).toBe(true);
});
test('installation policy wins, opt-outs are remembered and dependent features cannot bypass it',()=>{
 const config={...defaultConfig,experimentalMusic:true,experimentalParties:true,allowPlaybackSharing:true};
 expect(resolveFeatures(config,{music:false}).music.reason).toBe('personal');
 expect(resolveFeatures({...config,features:{social:false}},{social:true}).social.reason).toBe('administrator');
 const values=featureValues(config,{social:false,playback:false});
 expect(values.parties).toBe(false);expect(values.presence).toBe(false);expect(values.sharing).toBe(false);
 expect(values.screen).toBe(true);expect(values.reader).toBe(true);
 expect(featureValues({...config,features:{social:false}},{music:false}).music).toBe(false);
 expect(featureValues(config,{music:false}).music).toBe(false);
});
test('all media may be disabled without manufacturing a fallback medium',()=>{
 const config={...defaultConfig,experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true};
 const features=featureValues(config,{screen:false,music:false,game:false,book:false,comic:false});
 expect(mediumOptions({...config,features})).toEqual([]);
 for(const category of ['screen','music','game','book','comic','reading'])expect(categoryEnabled({...config,features},category)).toBe(false);
});

test('detail panels are standard navigation rather than an experiment or personal feature',()=>{
 expect(Object.keys(featureValues(defaultConfig))).not.toContain('mediaModal');
 expect(featureValues(defaultConfig)).not.toHaveProperty('mediaModal');
});
