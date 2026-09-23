import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icon-192.png", "icon-512.png", "logo.svg"],
      manifest: {
        name: "SecondBrain",
        short_name: "SecondBrain",
        description: "Captura, organiza y ejecuta — tu segundo cerebro",
        theme_color: "#1E3A8A",
        background_color: "#0F172A",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/logo.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [
              {
                // Some Chrome on Android versions silently drop the file when
                // accept is only the "image/*" wildcard. Enumerate real MIME
                // types and extensions so it always matches.
                name: "media",
                accept: [
                  "image/jpeg",
                  "image/jpg",
                  "image/png",
                  "image/webp",
                  "image/heic",
                  "image/heif",
                  "image/gif",
                  ".jpg",
                  ".jpeg",
                  ".png",
                  ".webp",
                  ".heic",
                  ".heif",
                  ".gif",
                ],
              },
            ],
          },
        },
      },
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/, /^\/share$/],
        importScripts: ['/sw-push.js', '/sw-share.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Take over from any previously installed SW immediately so fixes to
        // sw-share.js (and other imported scripts) reach users on the next
        // page load instead of waiting for every tab to close.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
