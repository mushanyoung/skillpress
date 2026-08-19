import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compileFromFile } from "json-schema-to-typescript";

const schemaPath = fileURLToPath(new URL("../schemas/skillpress.schema.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../src/config/generated.ts", import.meta.url));
const checkOnly = process.argv.includes("--check");

const generated = await compileFromFile(schemaPath, {
  bannerComment: "/* Generated from schemas/skillpress.schema.json. Do not edit by hand. */",
  style: {
    printWidth: 100,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    useTabs: false,
  },
  unreachableDefinitions: true,
});

if (checkOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => undefined);
  if (existing !== generated) {
    process.stderr.write(
      "Generated config types are stale. Run 'npm run generate:config-types'.\n",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated, { encoding: "utf8", mode: 0o644 });
}
