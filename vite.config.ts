import { defineConfig } from "vite";
import { streamMiddleware } from "./server/stream.mjs";

export default defineConfig({
  plugins: [
    {
      name: "industrial-stream",
      configureServer(server) {
        server.middlewares.use(streamMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(streamMiddleware);
      },
    },
  ],
  server: { host: "127.0.0.1" },
  build: { target: "es2022" },
});
