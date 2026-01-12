/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Teal/Cyan - CopyPools Brand (Primary)
        teal: {
          50: '#f0fdfc',
          100: '#ccfbf6',
          200: '#99f6ed',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        // Brand colors from design system
        brand: {
          hard: '#2c8684',
          medium: '#39adaa',
          soft: '#65cdca',
          light: '#79d3d1',
        },
        // Surface colors
        surface: {
          page: 'var(--surface-page)',
          'page-muted': 'var(--surface-page-muted)',
          card: 'var(--surface-card)',
        },
        // Text colors
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
        // Status colors
        status: {
          success: 'var(--success)',
          error: 'var(--error)',
          warning: 'var(--warning)',
          neutral: 'var(--neutral)',
        },
        // Deep Space Dark Mode
        dark: {
          950: '#020617',
          900: '#0f172a',
          800: '#1e293b',
        },
      },
      fontFamily: {
        sans: ['Source Sans 3', 'Inter', 'sans-serif'],
        heading: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'cyber-grid': 'linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)',
        'brand-gradient-hard': 'linear-gradient(90deg, #2c8684 0%, #329a97 100%)',
        'brand-gradient-medium': 'linear-gradient(90deg, #39adaa 0%, #3fc0bd 100%)',
        'brand-gradient-soft': 'linear-gradient(90deg, #65cdca 0%, #79d3d1 100%)',
      },
      boxShadow: {
        'glow-teal': '0 0 20px rgba(57, 173, 170, 0.3)',
        'glow-teal-lg': '0 0 40px rgba(57, 173, 170, 0.4)',
      },
    },
  },
  plugins: [],
};
