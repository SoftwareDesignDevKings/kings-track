/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Kings brand-adjacent palette — clean dark navy + slate
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#3b5bdb',
          600: '#2f4ac0',
          700: '#2040a8',
          900: '#0d2060',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
