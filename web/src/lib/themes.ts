export const THEMES = [
  { id: 'default',  label: '默认' },
  { id: 'academic', label: '学术' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
