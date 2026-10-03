import {test,expect} from 'bun:test';
import * as v from 'valibot';
import {registrationSchema} from '../src/lib/auth/registration';
const valid={username:'  Test.User ',displayName:' Test User ',password:'Twelve characters!',passwordConfirmation:'Twelve characters!'};
test('registration normalizes usernames and display names',()=>{const data=v.parse(registrationSchema,valid);expect(data.username).toBe('test.user');expect(data.displayName).toBe('Test User');});
test('registration rejects mismatched, short and oversized passwords and invalid names',()=>{for(const patch of [{passwordConfirmation:'different password'},{password:'short'},{password:'x'.repeat(129)},{displayName:' '},{username:'invalid name'}])expect(v.safeParse(registrationSchema,{...valid,...patch}).success).toBe(false);});
test('eight-character passwords need uppercase, lowercase and a special character, not a digit',()=>{
 for(const password of ['Abcdefg!','Password!'])expect(v.safeParse(registrationSchema,{...valid,password,passwordConfirmation:password}).success).toBe(true);
 for(const password of ['abcdefg!','ABCDEFG!','Abcdefgh','Abcdef!'])expect(v.safeParse(registrationSchema,{...valid,password,passwordConfirmation:password}).success).toBe(false);
});
