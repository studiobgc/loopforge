/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ur-black': '#000000',
        'ur-white': '#F5F5F0',
        'ur-red': '#CC0000',
        'ur-grey': '#888888',
      },
      fontFamily: {
        'mono': ['IBM Plex Mono', 'Courier New', 'monospace'],
        'display': ['Space Grotesk', 'Arial Black', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-fast': 'pulse 0.5s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
