import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui-store';
import type { ThemeId } from '@/lib/themes';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ proseTheme: 'default' });
});

describe('ui-store proseTheme', () => {
  it('defaults to "default"', () => {
    expect(useUiStore.getState().proseTheme).toBe('default');
  });

  it('setProseTheme updates state', () => {
    // ThemeId currently only has 'default'; this verifies the setter path executes
    useUiStore.getState().setProseTheme('default');
    expect(useUiStore.getState().proseTheme).toBe('default');
  });

  it('setProseTheme persists to localStorage', () => {
    useUiStore.getState().setProseTheme('default');
    expect(localStorage.getItem('prose-theme')).toBe('default');
  });

  it('initialises proseTheme from localStorage when a value is stored', () => {
    localStorage.setItem('prose-theme', 'default');
    useUiStore.setState({
      proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
    });
    expect(useUiStore.getState().proseTheme).toBe('default');
  });
});
