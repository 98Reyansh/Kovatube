/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'yt-red': 'rgb(var(--accent) / <alpha-value>)',
        'yt-red-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'yt-red-light': 'rgb(var(--accent-light) / <alpha-value>)',
        'yt-dark': 'rgb(var(--app-bg) / <alpha-value>)',
        'yt-light': '#F9F9F9',
      }
    },
  },
  plugins: [],
}