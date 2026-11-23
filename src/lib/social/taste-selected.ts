export const selectedRuleLabels = {
  personal: 'Personal fit',
  'exact-team': 'Creative team',
  'personalised-tmdb': 'Your agreement with TMDB audiences',
  'story-credit': 'Similar story and credits',
  'person-company': 'Similar work from the same person and company',
} as const;

export type SelectedRule = keyof typeof selectedRuleLabels;
