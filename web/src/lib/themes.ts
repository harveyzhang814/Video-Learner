export const THEMES = [
  { id: 'default', label: '默认' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
