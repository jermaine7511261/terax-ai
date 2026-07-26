import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) return "vendor";
          return null;
        },
      },
    },
  },
});
