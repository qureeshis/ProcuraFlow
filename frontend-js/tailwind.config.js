/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef8fc',
          100: '#d8eef7',
          500: '#087fbd',
          600: '#075fa8',
          700: '#074c8c',
          900: '#063364',
        },
        slate: { 950: '#0b1220' },
      },
    },
  },
  plugins: [],
};
