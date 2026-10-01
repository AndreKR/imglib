import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const imageBase = "https://raw.githubusercontent.com/AndreKR/imglib/master/";

export function preparePackage({ rootPath }) {
  const distPath = join(rootPath, "dist");
  mkdirSync(distPath, { recursive: true });

  const manifest = JSON.parse(readFileSync(join(rootPath, "package.json"), "utf8"));
  delete manifest.private;
  delete manifest.scripts;
  delete manifest.devDependencies;
    delete manifest.packageManager;
  manifest.main = "./index.js";
  manifest.types = "./index.d.ts";
  manifest.exports = {
    ".": {
      types: "./index.d.ts",
      import: "./index.js"
    }
  };
  manifest.files = ["*.js", "*.d.ts"];
  writeFileSync(join(distPath, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const readme = readFileSync(join(rootPath, "README.md"), "utf8").replace(
    /(!\[[^\]\r\n]*\]\()(?:\.\/)?(tests\/[^)\s]+)(\))/g,
    (_, start, path, end) => `${start}${imageBase}${path}${end}`
  );
  writeFileSync(join(distPath, "README.md"), readme);
  copyFileSync(join(rootPath, "LICENSE"), join(distPath, "LICENSE"));

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparePackage({ rootPath: fileURLToPath(new URL("../", import.meta.url)) });
}
