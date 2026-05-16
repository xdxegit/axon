import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative asset paths so the built HTML works under Electron's file:// scheme.
  // Without this, dist/index.html references "/assets/..." which resolves to the disk
  // root under file://, the bundle never loads, and the window renders blank.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  }
});
