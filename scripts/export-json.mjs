// Imports the data barrel from src/data/index.js and writes pages and schema
// as standalone JSON files, plus a grouped Endpoints.json (all groups
// combined), one standalone file per individual endpoint group, a combined
// Security.json for everything else, and a combined FullSpec.json. Run with
// plain Node (package.json has "type": "module", and src/data has zero
// external dependencies, so no npm install is required first).
//
//   node scripts/export-json.mjs [outDir]
//   DEBUG_EXPORT=1 node scripts/export-json.mjs   # to see how each export was classified
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

// SOME_CONSTANT_NAME -> "Some constant name" (lowercase, first letter capitalized)
function humanize(key) {
    return key
        .toLowerCase()
        .split("_")
        .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(" ");
}

// SOME_GROUP -> "SomeGroup" (PascalCase, no separators, for filenames)
function pascalCase(key) {
    return key
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

const ENDPOINTS_SUFFIX = "_ENDPOINTS";
const RESERVED_KEYS = new Set(["ENDPOINTS", "PAGES", "SCHEMA"]);
const debug = process.env.DEBUG_EXPORT === "1";

const endpoints = {};
const security = {};
const endpointFiles = []; // { groupName, fileName } for logging + release body reference

for (const [key, value] of Object.entries(data)) {
    if (RESERVED_KEYS.has(key)) {
        if (debug) console.log(`[reserved]  ${key}`);
        continue;
    }

    if (key.endsWith(ENDPOINTS_SUFFIX)) {
        const rawGroup = key.slice(0, -ENDPOINTS_SUFFIX.length);
        const groupName = humanize(rawGroup);
        endpoints[groupName] = value;

        const fileName = `${pascalCase(rawGroup)}Endpoints.json`;
        writeFileSync(join(outDir, fileName), JSON.stringify(value, null, 2));
        endpointFiles.push({ groupName, fileName });

        if (debug) console.log(`[endpoints] ${key} -> "${groupName}" (${fileName})`);
    } else {
        const groupName = humanize(key);
        security[groupName] = value;
        if (debug) console.log(`[security]  ${key} -> "${groupName}"`);
    }
}

writeFileSync(join(outDir, "Endpoints.json"), JSON.stringify(endpoints, null, 2));
writeFileSync(join(outDir, "Pages.json"), JSON.stringify(data.PAGES, null, 2));
writeFileSync(join(outDir, "Schema.json"), JSON.stringify(data.SCHEMA, null, 2));

const spec = {
    Endpoints: Object.entries(endpoints).map(([name, value]) => ({ [name]: value })),
    Security: security,
    Pages: data.PAGES,
    Schema: data.SCHEMA,
};

writeFileSync(join(outDir, "Security.json"), JSON.stringify(security, null, 2));
writeFileSync(join(outDir, "FullSpec.json"), JSON.stringify(spec, null, 2));

const endpointFileList = endpointFiles.map((e) => e.fileName).join(", ");
console.log(
    `Wrote Endpoints.json, Pages.json, Schema.json, Security.json, FullSpec.json, and per-group files (${endpointFileList}) to ${outDir}/`
);
