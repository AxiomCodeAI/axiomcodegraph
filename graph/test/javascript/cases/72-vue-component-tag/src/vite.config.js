import { fileURLToPath, URL } from "node:url";
export default {
  resolve: { alias: { "@": fileURLToPath(new URL("./components", import.meta.url)) } },
};
