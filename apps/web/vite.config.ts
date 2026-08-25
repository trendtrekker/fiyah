import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/admin": "http://localhost:4000",
      "/public": "http://localhost:4000",
      "/sandbox": "http://localhost:4000",
      "/health": "http://localhost:4000"
    }
  }
});
