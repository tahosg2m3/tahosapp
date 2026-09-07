/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tahosapp: {
          100: '#F2F3F5', // Metin Rengi
          200: '#DBDEE1', // İkon ve Üst Metin
          300: '#B5BAC1', // Soluk Metin
          400: '#949BA4', // Meta Metin (Saat vb.)
          500: '#111214', // Tooltip Arka Planı
          600: '#404249', // Hover overlay
          700: '#313338', // İkincil arka plan (Butonlar vb.)
          800: '#2B2D31', // Sohbet (Chat) arka planı
          900: '#1E1F22', // Sunucu Listesi arka planı
          blurple: '#5865F2', // Aktif Mavi
          green: '#23A559', // Ekleme Yeşili
          red: '#DA373C', // Silme Kırmızısı
          link: '#00A8FC' // Link Mavisi
        }
      },
    },
  },
  plugins: [],
}
