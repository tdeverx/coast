/** Public API permissions are independent of browser settings and administrator roles. */
export const apiScopes=['catalogue:read','collection:read','library:read','progress:read'] as const;
export type ApiScope=typeof apiScopes[number];
export const apiScopeLabels:Record<ApiScope,string>={
  'catalogue:read':'Shared catalogue', 'collection:read':'Your Collection',
  'library:read':'Your accessible Library', 'progress:read':'Your progress and relationships',
};
