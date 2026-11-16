import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' — збірка працює з будь-якого шляху (GitHub Pages, Netlify, Vercel, локально)
export default defineConfig({
  base: './',
  plugins: [react()],
})
