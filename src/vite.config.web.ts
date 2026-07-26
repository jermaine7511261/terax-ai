import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    port: 1421,
    proxy: {
      "/api": {
        target: "http://localhost:1984",
        changeOrigin: true,
      },
    },
  },
});
