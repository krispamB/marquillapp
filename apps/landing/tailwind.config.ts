import type { Config } from 'tailwindcss';
import { themeConfig } from './config/theme';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: themeConfig.colors.primary,
        secondary: themeConfig.colors.secondary,
        accent: themeConfig.colors.accent,
        background: themeConfig.colors.background,
        surface: themeConfig.colors.surface,
        'text-primary': themeConfig.colors.text.primary,
        'text-secondary': themeConfig.colors.text.secondary,
      },
      fontFamily: {
        heading: [themeConfig.fonts.heading],
        body: [themeConfig.fonts.body],
      },
      spacing: {
        section: themeConfig.spacing.section,
      },
    },
  },
  plugins: [],
};

export default config;
