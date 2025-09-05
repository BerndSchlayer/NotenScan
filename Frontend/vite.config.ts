import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@schlayer-consulting/sc-base-frontend"],
    // Prebundle to avoid mixed CJS/ESM issues in dev
    include: ["react-easy-crop", "normalize-wheel-es"],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      // Force ESM-compatible implementation to avoid default export error in dev
      "normalize-wheel": "normalize-wheel-es",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["!**/node_modules/@schlayer-consulting/sc-base-frontend/**"],
    },
  },
  build: {
    rollupOptions: {
      plugins: [
        visualizer({
          filename: "stats.html",
          open: true,
          gzipSize: true,
          brotliSize: true,
        }),
      ],
    },
  },
});
