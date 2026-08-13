/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          500: '#3563e9',
          600: '#274ec2',
          700: '#1f3d99',
          900: '#152a6b',
        },
        slate: {
          950: '#0b1220',
        },
      },
    },
  },
  plugins: [],
};
