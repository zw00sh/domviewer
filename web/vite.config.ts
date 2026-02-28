import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/payload.js": "http://localhost:3000",
      "/test": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/view": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
