module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'roboto': ['"Roboto"', 'sans-serif'],
        'sigmar-one': ['"Sigmar One"', 'cursive']
      }
    },
    colors: {
      sajat: {
        100: '#ffbb6c',
        200: '#eaa26b',
        300: '#d4896a',
        400: '#ba7b68',
        500: '#9f6c66',
        600: '#78545c',
        700: '#503c52',
        800: '#3b2f44',
        900: '#262335',
      },

      proba: {
        100: "#d1d6d4",
        200: "#a4aea9",
        300: "#76857d",
        400: "#495d52",
        500: "#1b3427",
        600: "#162a1f",
        700: "#101f17",
        800: "#0b1510",
        900: "#050a08"
      }
    },
    screens: {
      'xs': { 'min': '0px', 'max': '599px' },
      'sm': { 'min': '600px', 'max': '899px' },
      // => @media (min-width: 180px and max-width: 767px) { ... }

      'md': { 'min': '900px', 'max': '1199px' },
      // => @media (min-width: 768px and max-width: 1023px) { ... }

      'lg': { 'min': '1200px', 'max': '1535px' },
      // => @media (min-width: 1024px and max-width: 1279px) { ... }

      'xl': { 'min': '1536px', 'max': '90000px' },
      // => @media (min-width: 1280px and max-width: 1535px) { ... }

      // '2xl': { 'min': '1536px' },
      // => @media (min-width: 1536px) { ... }
    },
  },
  plugins: [
    require('@themesberg/flowbite/plugin')
  ],
}