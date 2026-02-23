export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          50: '#F9F9F6', // workspace background (ivory)
          100: '#F4F4F0', // sidebar background (off-white)
        },
      },
    },
  },
  plugins: [],
};
