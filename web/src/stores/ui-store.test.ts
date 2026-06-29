import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui-store';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ proseTheme: 'default' });
});

describe('ui-store proseTheme', () => {
  it('defaults to "default"', () => {
    expect(useUiStore.getState().proseTheme).toBe('default');
  });

  it('setProseTheme updates state', () => {
    useUiStore.getState().setProseTheme('minimal');
    expect(useUiStore.getState().proseTheme).toBe('minimal');
  });

  it('setProseTheme persists to localStorage', () => {
    useUiStore.getState().setProseTheme('minimal');
    expect(localStorage.getItem('prose-theme')).toBe('minimal');
  });
});
