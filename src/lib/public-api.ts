/** Public API permissions are independent of browser settings and administrator roles. */
export const apiScopes=['catalogue:read','collection:read','library:read','progress:read','tracking:write','relationships:write','ratings:write','music:write','games:write','webhooks:manage'] as const;
export type ApiScope=typeof apiScopes[number];
export const apiScopeLabels:Record<ApiScope,string>={
  'catalogue:read':'Shared catalogue', 'collection:read':'Your Collection',
  'library:read':'Your accessible Library',
  'tracking:write':'Change your screen tracking', 'relationships:write':'Change your Collected, saved and favourite status',
  'ratings:write':'Change your ratings', 'music:write':'Log your music listens', 'games:write':'Manage your game playthroughs and sessions', 'webhooks:manage':'Manage your webhook subscriptions', 'progress:read':'Your progress and relationships',
};
