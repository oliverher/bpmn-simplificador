import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base é sobrescrito no CI (GitHub Pages serve em /<repo>/); localmente fica na raiz
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
})
