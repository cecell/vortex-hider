import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist", {
  recursive: true,
});

await build({
  entryPoints: [
    "src/index.ts",
  ],

  outfile: "dist/index.js",

  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",

  /*
   * vortex-api is supplied by Vortex itself.
   * redux-act and anything else is bundled.
   */
  external: [
    "vortex-api",
  ],

  sourcemap: true,
});

await copyFile(
  "info.json",
  "dist/info.json",
);

console.log("Built Profile Mod Hider into ./dist");