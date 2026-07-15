/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Attio-dense defaults; base 13px
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['12px', { lineHeight: '18px' }],
        base: ['13px', { lineHeight: '20px' }],
        md: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['18px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '30px' }],
      },
      colors: {
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--accent)',
        background: 'var(--bg)',
        foreground: 'var(--text-primary)',
        panel: 'var(--panel)',
        muted: {
          DEFAULT: 'var(--panel)',
          foreground: 'var(--text-secondary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: '#FFFFFF',
        },
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: 'var(--panel)',
          foreground: 'var(--text-primary)',
        },
        destructive: {
          DEFAULT: 'var(--red)',
          foreground: '#FFFFFF',
        },
        popover: {
          DEFAULT: 'var(--bg)',
          foreground: 'var(--text-primary)',
        },
        card: {
          DEFAULT: 'var(--bg)',
          foreground: 'var(--text-primary)',
        },
        health: {
          green: 'var(--green)',
          amber: 'var(--amber)',
          red: 'var(--red)',
        },
      },
      borderRadius: {
        lg: '8px',
        md: '6px',
        sm: '4px',
      },
      boxShadow: {
        popover: '0 4px 16px -4px rgba(16,24,40,0.12), 0 2px 6px -2px rgba(16,24,40,0.08)',
      },
      spacing: {
        row: '36px',
        sidebar: '232px',
        panel: '320px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
