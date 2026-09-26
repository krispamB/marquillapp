import type { Config } from 'tailwindcss';

const themeConfig = {
  colors: {
    primary: '#f25623',
    secondary: '#4D4D4D',
    accent: '#DEDEDE',
    background: '#FFFFFF',
    surface: '#F3F4F6',
    text: {
      primary: '#171717',
      secondary: '#6B7280',
    },
  },
  fonts: {
    heading: 'Inter, sans-serif',
    body: 'Inter, sans-serif',
  },
  spacing: {
    section: '5rem',
  },
};

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
