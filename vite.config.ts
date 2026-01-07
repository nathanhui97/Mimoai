import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './public/manifest.json'

// Generate build hash from current timestamp
const buildHash = `build-${Date.now().toString(36)}`;
const buildTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

console.log(`🔨 Building extension - Version: ${buildTimestamp}, Hash: ${buildHash}`);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  define: {
    // Inject build info into code
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(buildHash),
    'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
  },
})
