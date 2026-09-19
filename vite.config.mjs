import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { assistantPlugin } from "./server/assistant.mjs";
import { dataPlugin } from "./server/data-api.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // The local database (data/daybook.db, or DAYBOOK_DB) comes before the AI routes.
    dataPlugin(),
    assistantPlugin({
      ...loadEnv("development", process.cwd(), ""),
      ...process.env,
    }),
  ],
});
