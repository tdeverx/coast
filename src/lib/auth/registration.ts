import * as v from 'valibot';
export const usernameRequirements = [
  { icon: 'ruler', label: 'Username length', detail: 'Use 3 to 32 characters.', schema: v.pipe(v.string(), v.minLength(3, 'Use 3 or more characters.'), v.maxLength(32, 'Use at most 32 characters.')) },
  { icon: 'right', label: 'First character', detail: 'Start with a letter or number.', schema: v.pipe(v.string(), v.regex(/^[A-Za-z0-9]/, 'Start with a letter or number.')) },
  { icon: 'atSign', label: 'Allowed characters', detail: 'Choose letters (A–Z), numbers (0–9), dots, underscores or hyphens.', schema: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]+$/, 'Use only letters, numbers, dots, underscores or hyphens.')) },
] as const;
export const usernameSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), ...usernameRequirements.map(rule => rule.schema));
export const passwordRequirements = [
  { icon: 'ruler', label: 'Password length', detail: 'Use 8 to 128 characters.', schema: v.pipe(v.string(), v.minLength(8, 'Use 8 or more characters.'), v.maxLength(128, 'Use at most 128 characters.')) },
  { icon: 'uppercase', label: 'Uppercase letter', detail: 'Include one capital letter from A to Z.', schema: v.pipe(v.string(), v.regex(/[A-Z]/, 'Include an uppercase letter.')) },
  { icon: 'lowercase', label: 'Lowercase letter', detail: 'Add one lowercase letter from a to z.', schema: v.pipe(v.string(), v.regex(/[a-z]/, 'Include a lowercase letter.')) },
  {
    icon: 'atSign', label: 'Special character',
    detail: 'Choose one symbol (! @ # $ % & * or ?).',
    schema: v.pipe(v.string(), v.regex(/[^A-Za-z0-9\s]/, 'Include a special character.')),
  },
] as const;
export const passwordSchema = v.pipe(v.string(), ...passwordRequirements.map(rule => rule.schema));
export const registrationFields = {
 username: usernameSchema,
 displayName: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a display name.'), v.maxLength(60)),
 password: passwordSchema,
 passwordConfirmation: v.string(),
};
export const registrationSchema = v.pipe(v.object({...registrationFields,code:v.optional(v.pipe(v.string(),v.trim()),'')}),v.forward(v.check(data => data.password === data.passwordConfirmation, 'Passwords must match.'),['passwordConfirmation']));
