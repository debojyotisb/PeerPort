import { create } from 'zustand';

export type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeState {
  mode: ThemeMode;
  effectiveTheme: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const getSystemTheme = (): 'dark' | 'light' => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  };

  const initialMode: ThemeMode = (typeof localStorage !== 'undefined' && (localStorage.getItem('peerport_theme') as ThemeMode)) || 'system';
  const initialEffective = initialMode === 'system' ? getSystemTheme() : initialMode;

  // Apply to document root
  if (typeof document !== 'undefined') {
    if (initialEffective === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  return {
    mode: initialMode,
    effectiveTheme: initialEffective,
    setMode: (mode) => {
      const effective = mode === 'system' ? getSystemTheme() : mode;
      localStorage.setItem('peerport_theme', mode);

      if (effective === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      set({ mode, effectiveTheme: effective });
    },
    toggleTheme: () => {
      const current = get().effectiveTheme;
      const next = current === 'dark' ? 'light' : 'dark';
      get().setMode(next);
    }
  };
});
