import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend for DermaScan. The backend URL is read from VITE_API_URL at build
// time; src/api.js falls back to http://localhost:5000 when it is not set.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
