import * as v from 'valibot';
export const usernameSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/, 'Use 3–32 letters, numbers, dots, underscores or hyphens.'));
export const passwordSchema = v.pipe(v.string(), v.minLength(12, 'Use at least 12 characters.'), v.maxLength(128, 'Use at most 128 characters.'));
export const registrationFields = {
 username: usernameSchema,
 displayName: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a display name.'), v.maxLength(60)),
 password: passwordSchema,
 passwordConfirmation: v.string(),
};
export const registrationSchema = v.pipe(v.object({...registrationFields,code:v.optional(v.pipe(v.string(),v.trim()),'')}),v.forward(v.check(data => data.password === data.passwordConfirmation, 'Passwords must match.'),['passwordConfirmation']));
