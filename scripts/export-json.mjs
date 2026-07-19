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
//
// lastUpdated: every row (page, endpoint, schema table entry, security
// item) is stamped with the last-commit date of the src/data/*.js file it
// was defined in — NOT the time this script was run. This requires the
// script to run inside a git working tree with real history (a shallow
// `--depth=1` clone will make every file look equally "just committed",
// since only the most recent commit is present). Falls back to filesystem
// mtime if git isn't available or the file isn't tracked, but mtime resets
// on every clone/checkout and should be treated as a degraded signal, not
// a trustworthy one.

import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as data from "../src/data/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../src/data");

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

// ─── lastUpdated ────────────────────────────────────────────────────────
// Explicit export-key -> source-file map, mirrored from the imports in
// src/data/index.js. Kept explicit rather than derived from the key name
// (e.g. lowercasing "ALERT_ENDPOINTS" -> "alert.js") because that mapping
// isn't purely mechanical: ALERT_ENDPOINTS actually lives in alerts.js,
// plural. A wrong guess here would silently attach the wrong file's date
// to a group's rows, which is worse than not having lastUpdated at all —
// so this stays a hardcoded lookup, update it if index.js's imports change.
const SOURCE_FILES = {
    AUTH_ENDPOINTS: "auth.js",
    CONFIG_ENDPOINTS: "config.js",
    TELEMETRY_ENDPOINTS: "telemetry.js",
    ALERT_ENDPOINTS: "alerts.js",
    USERS_ENDPOINTS: "users.js",
    WEBHOOKS_ENDPOINTS: "webhooks.js",
    AI_ENDPOINTS: "ai.js",
    INTERNAL_ENDPOINTS: "internal.js",
    PAGES: "pages.js",
    SCHEMA: "schema.js",
    AUTH_STRATEGIES: "gateway.js",
    FILTER_CHAIN: "gateway.js",
    STARTUP_SEQUENCE: "gateway.js",
    RATE_LIMITING_INFO: "gateway.js",
    ROLE_ENFORCEMENT_INFO: "gateway.js",
};

const dateCache = new Map();

function lastUpdated(fileName) {
    if (dateCache.has(fileName)) return dateCache.get(fileName);
    const filePath = join(DATA_DIR, fileName);
    let iso;
    try {
        const out = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
            encoding: "utf8",
            cwd: DATA_DIR,
        }).trim();
        if (!out) throw new Error("file has no git history (untracked or new)");
        iso = out;
    } catch (err) {
        if (debug) console.log(`[lastUpdated] git lookup failed for ${fileName} (${err.message}), falling back to mtime`);
        iso = statSync(filePath).mtime.toISOString();
    }
    dateCache.set(fileName, iso);
    return iso;
}

// Stamps lastUpdated onto every row of an array (Pages, each Endpoints
// group, FilterChain, StartupSequence, RateLimitingInfo). Returns a new
// array — never mutates the imported module's array in place, since the
// same objects are also spread into data.ENDPOINTS in index.js and reused
// across multiple output files in this script.
function stampArray(rows, fileName) {
    const when = lastUpdated(fileName);
    return rows.map((row) => ({ ...row, lastUpdated: when }));
}

// Stamps lastUpdated onto every top-level entry of an object keyed by name
// (Schema, keyed by table name; AuthStrategies, keyed by strategy name).
function stampObject(obj, fileName) {
    const when = lastUpdated(fileName);
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, { ...value, lastUpdated: when }])
    );
}

// RoleEnforcementInfo isn't a flat array/object of uniform rows — it's one
// { note, roles } structure. Stamped once at the top level rather than
// per-role, since "per-row" doesn't cleanly apply to it.
function stampSingle(obj, fileName) {
    return { ...obj, lastUpdated: lastUpdated(fileName) };
}

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
        const stamped = stampArray(value, SOURCE_FILES[key]);
        endpoints[groupName] = stamped;

        const fileName = `${pascalCase(rawGroup)}Endpoints.json`;
        writeFileSync(join(outDir, fileName), JSON.stringify(stamped, null, 2));
        endpointFiles.push({ groupName, fileName });

        if (debug) console.log(`[endpoints] ${key} -> "${groupName}" (${fileName}), lastUpdated from ${SOURCE_FILES[key]}`);
    } else {
        const groupName = humanize(key);
        const sourceFile = SOURCE_FILES[key];

        // These security exports aren't all shaped the same way, so each
        // gets stamped with the function matching its actual shape.
        let stamped;
        if (key === "ROLE_ENFORCEMENT_INFO") {
            stamped = stampSingle(value, sourceFile);
        } else if (key === "AUTH_STRATEGIES") {
            stamped = stampObject(value, sourceFile);
        } else {
            // FILTER_CHAIN, STARTUP_SEQUENCE, RATE_LIMITING_INFO — arrays
            stamped = stampArray(value, sourceFile);
        }

        security[groupName] = stamped;
        if (debug) console.log(`[security]  ${key} -> "${groupName}", lastUpdated from ${sourceFile}`);
    }
}

const stampedPages = stampArray(data.PAGES, SOURCE_FILES.PAGES);
const stampedSchema = stampObject(data.SCHEMA, SOURCE_FILES.SCHEMA);

// Shared shape: FullSpec.json's "Endpoints" field is an array of single-key
// objects (one per group) rather than one flat object, so Backend.json and
// Frontend.json reuse the same array for consistency with FullSpec.json —
// anything already parsing FullSpec.json's Endpoints field works unchanged
// against these.
const endpointsArray = Object.entries(endpoints).map(([name, value]) => ({ [name]: value }));

writeFileSync(join(outDir, "Endpoints.json"), JSON.stringify(endpoints, null, 2));
writeFileSync(join(outDir, "Pages.json"), JSON.stringify(stampedPages, null, 2));
writeFileSync(join(outDir, "Schema.json"), JSON.stringify(stampedSchema, null, 2));

const spec = {
    Endpoints: endpointsArray,
    Security: security,
    Pages: stampedPages,
    Schema: stampedSchema,
};

const backend = {
    Endpoints: endpointsArray,
    Schema: stampedSchema,
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
//
// API_KEY and INTERNAL_ONLY are dropped from the frontend's copy of Auth
// strategies specifically: API_KEY is an operator/service credential the
// browser client never holds or sends, and INTERNAL_ONLY only gates
// /internal/* routes the frontend can never reach in the first place.
// Neither is a strategy a frontend dev implements against.
const FRONTEND_EXCLUDED_AUTH_STRATEGIES = new Set(["API_KEY", "INTERNAL_ONLY"]);
const frontendAuthStrategies = Object.fromEntries(
    Object.entries(security["Auth strategies"] ?? {}).filter(
        ([key]) => !FRONTEND_EXCLUDED_AUTH_STRATEGIES.has(key)
    )
);

const frontend = {
    Pages: stampedPages,
    Endpoints: endpointsArray,
    AuthStrategies: frontendAuthStrategies,
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