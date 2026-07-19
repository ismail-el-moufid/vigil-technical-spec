// Imports the data barrel from src/data/index.js and writes pages and schema
// as standalone JSON files, plus a grouped Endpoints.json (all groups
// combined), one standalone file per individual endpoint group, a combined
// Security.json for everything else, a combined Backend.json (endpoints +
// schema + security), a combined Frontend.json (pages + endpoints), and a
// combined FullSpec.json. Run with plain Node (package.json has "type":
// "module", and src/data has zero external dependencies, so no npm install
// is required first).
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

// Shared shape: FullSpec.json's "Endpoints" field is an array of single-key
// objects (one per group) rather than one flat object, so Backend.json and
// Frontend.json reuse the same array for consistency with FullSpec.json —
// anything already parsing FullSpec.json's Endpoints field works unchanged
// against these.
const endpointsArray = Object.entries(endpoints).map(([name, value]) => ({ [name]: value }));

writeFileSync(join(outDir, "Endpoints.json"), JSON.stringify(endpoints, null, 2));
writeFileSync(join(outDir, "Pages.json"), JSON.stringify(data.PAGES, null, 2));
writeFileSync(join(outDir, "Schema.json"), JSON.stringify(data.SCHEMA, null, 2));

const spec = {
    Endpoints: endpointsArray,
    Security: security,
    Pages: data.PAGES,
    Schema: data.SCHEMA,
};

const backend = {
    Endpoints: endpointsArray,
    Schema: data.SCHEMA,
    Security: security,
};

// Frontend.json also needs enough of Security to make sense of each
// endpoint's authStrategy/requiredRole tags — those are just short labels
// (e.g. "JWT", "ADMIN_/_VIEWER") on every endpoint object; the actual
// behavior (token lifetime, where it's stored, refresh flow, which routes
// need ADMIN vs any authenticated caller) lives in AUTH_STRATEGIES and
// ROLE_ENFORCEMENT_INFO. Pulled in by name rather than spreading all of
// `security`, since Filter chain / Startup sequence / Rate limiting info
// are backend/infra concerns the frontend doesn't implement against.
const frontend = {
    Pages: data.PAGES,
    Endpoints: endpointsArray,
    AuthStrategies: security["Auth strategies"],
    RoleEnforcement: security["Role enforcement info"],
};

writeFileSync(join(outDir, "Security.json"), JSON.stringify(security, null, 2));
writeFileSync(join(outDir, "Backend.json"), JSON.stringify(backend, null, 2));
writeFileSync(join(outDir, "Frontend.json"), JSON.stringify(frontend, null, 2));
writeFileSync(join(outDir, "FullSpec.json"), JSON.stringify(spec, null, 2));

const endpointFileList = endpointFiles.map((e) => e.fileName).join(", ");
console.log(
    `Wrote Endpoints.json, Pages.json, Schema.json, Security.json, Backend.json, Frontend.json, FullSpec.json, and per-group files (${endpointFileList}) to ${outDir}/`
);
