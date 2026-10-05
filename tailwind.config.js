/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'theme-dark': '#04120f',
        'theme-gold': '#d4af37',
        'theme-light': '#e8e8e8',
        'theme-muted': '#b0c4de',
      },
      fontFamily: {
        sans: ['Arial', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
