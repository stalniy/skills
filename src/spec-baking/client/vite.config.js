import { defineConfig } from "vite";

export default defineConfig({
  input: 'index.html',
  build: {
    license: { fileName: "licenses.md" },
    sourcemap: true,
  },
});
