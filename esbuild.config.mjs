import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

// Main loader entry
const loaderCtx = await esbuild.context({
  entryPoints: ["client/loader.js"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  outfile: "dist/loader.bundle.js",
});

// Find all payload modules in client/payloads/
const payloadsDir = "client/payloads";
const payloadFiles = fs.existsSync(payloadsDir)
  ? fs.readdirSync(payloadsDir).filter((f) => f.endsWith(".js"))
  : [];

// Each payload is wrapped so it returns { init, destroy } when evaluated
const payloadContexts = [];
for (const file of payloadFiles) {
  const name = path.basename(file, ".js");
  const ctx = await esbuild.context({
    entryPoints: [path.join(payloadsDir, file)],
    bundle: true,
    format: "iife",
    globalName: "__payload__",
    minify: true,
    target: "es2020",
    outfile: `dist/payloads/${name}.bundle.js`,
  });
  payloadContexts.push({ name, ctx });
}

if (watch) {
  await loaderCtx.watch();
  for (const { ctx } of payloadContexts) await ctx.watch();
  console.log("Watching for changes...");
} else {
  await loaderCtx.rebuild();
  await loaderCtx.dispose();
  for (const { name, ctx } of payloadContexts) {
    await ctx.rebuild();
    await ctx.dispose();
  }
  console.log("Built dist/loader.bundle.js");
  for (const { name } of payloadContexts) {
    console.log(`Built dist/payloads/${name}.bundle.js`);
  }
}
