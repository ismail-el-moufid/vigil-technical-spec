import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sourceLinksPlugin } from './scripts/source-links-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
	cacheDir: join(tmpdir(), `vigil-technical-spec-vite-${userInfo().uid}`),
	plugins: [react(), sourceLinksPlugin()],
})
