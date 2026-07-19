// Imports every named export from src/data/index.js and writes each one
// out as its own JSON file, plus a combined all.json. Run with plain Node
// (package.json has "type": "module", and src/data has zero external
// dependencies, so no npm install is required first).
//
//   node scripts/export-json.mjs [outDir]
//
// Note: this serializes the actual data values only. Comments in the
// source .js files (which carry a lot of the spec's reasoning) are not
// data and do not survive this conversion — if that context matters for
// what you're handing to an AI tool, ship the .js source alongside the
// JSON, not instead of it.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as data from "../src/data/index.js";

const outDir = process.argv[2] ?? "dist/json";
mkdirSync(outDir, { recursive: true });

for (const [name, value] of Object.entries(data)) {
	writeFileSync(join(outDir, `${name.toLocaleLowerCase().replaceAll("_", " ")}.json`), JSON.stringify(value, null, 2));
}

writeFileSync(join(outDir, "Spec.json"), JSON.stringify(data, null, 2));

console.log(`Wrote ${Object.keys(data).length} exports + all.json to ${outDir}/`);
