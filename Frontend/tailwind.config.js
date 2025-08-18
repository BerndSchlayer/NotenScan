/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
    "./node_modules/@schlayer-consulting/sc-base-frontend/dist/**/*.{js,mjs}"
  ],  
  theme: {
    extend: {},
  },
  plugins: [],
}
