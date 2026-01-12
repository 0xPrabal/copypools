import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

type ThemeStore = {
  theme: Theme;
  hydrated: boolean;
  initTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'dark', // Default to dark mode
      hydrated: false,

      initTheme: () => {
        const currentTheme = get().theme;
        document.documentElement.classList.toggle('dark', currentTheme === 'dark');
        set({ hydrated: true });
      },

      setTheme: (theme: Theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set({ theme });
      },

      toggleTheme: () => {
        const currentTheme = get().theme;
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
        set({ theme: newTheme });
      },
    }),
    {
      name: 'copypools-theme-storage',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);
