import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ARCHITECTURE_DELIVERY_DIAGRAM, ARCHITECTURE_SECTIONS } from "../src/data/architecture.js";

// Read the deliberately small source convention: explicit quoted node declarations,
// subgraphs and labeled edges. This checks topology, not Mermaid browser rendering.
function readGraph(source)
{
	const [header, ...lines] = source.trim().split("\n").map((line) => line.trim());
	assert.match(header, /^flowchart (TD|LR)$/);
	const nodes = new Map();
	const groups = new Map();
	const edges = [];
	const owners = [];
	for (const line of lines)
	{
		if (!line) continue;
		const group = line.match(/^subgraph (\w+)\["([^"]+)"\]$/);
		const node = line.match(/^(\w+)(?:\["([^"]+)"\]|\[\("([^"]+)"\)\]|\{"([^"]+)"\})$/);
		const edge = line.match(/^(\w+)\s+(-->|-\.->|<-->)\|"([^"]+)"\|\s+(\w+)$/);
		if (group)
		{
			assert.ok(!groups.has(group[1]), "Duplicate subgraph: " + group[1]);
			groups.set(group[1], { label: group[2], owners: [...owners] });
			owners.push(group[1]);
		}
		else if (line === "end")
		{
			assert.ok(owners.length, "Unmatched subgraph end");
			owners.pop();
		}
		else if (node)
		{
			assert.ok(!nodes.has(node[1]), "Duplicate node: " + node[1]);
			nodes.set(node[1], { label: node[2] ?? node[3] ?? node[4], decision: Boolean(node[4]), owners: [...owners] });
		}
		else if (edge)
		{
			edges.push({ from: edge[1], kind: edge[2], label: edge[3], to: edge[4] });
		}
		else
		{
			assert.fail("Unrecognized architecture graph statement: " + line);
		}
	}
	assert.equal(owners.length, 0, "Unclosed subgraph");
	for (const edge of edges)
	{
		assert.ok(nodes.has(edge.from), "Undeclared source node: " + edge.from);
		assert.ok(nodes.has(edge.to), "Undeclared target node: " + edge.to);
	}
	for (const id of groups.keys()) assert.ok(!nodes.has(id), "Node / subgraph ID collision: " + id);
	return { header, nodes, groups, edges };
}

function graph(id)
{
	const section = ARCHITECTURE_SECTIONS.find((entry) => entry.id === id);
	assert.ok(section, "Missing section: " + id);
	assert.equal(typeof section.diagram, "string", id + ": missing diagram");
	return readGraph(section.diagram);
}

function edge(graph, from, to, label)
{
	const found = graph.edges.find((entry) => entry.from === from && entry.to === to);
	assert.ok(found, "Missing edge: " + from + " -> " + to);
	if (label) assert.match(found.label, label);
	return found;
}

function reaches(graph, start, target)
{
	const pending = [start];
	const seen = new Set();
	while (pending.length)
	{
		const current = pending.pop();
		if (current === target) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const link of graph.edges)
		{
			if (link.from === current) pending.push(link.to);
			if (link.kind === "<-->" && link.to === current) pending.push(link.from);
		}
	}
	return false;
}

function longestPath(graph, id, seen = new Set())
{
	if (seen.has(id)) return 0;
	const nextSeen = new Set([...seen, id]);
	const next = graph.edges.filter((link) => link.from === id && link.kind !== "<-->");
	return 1 + Math.max(0, ...next.map((link) => longestPath(graph, link.to, nextSeen)));
}

function owned(graph, node, group)
{
	assert.ok(graph.nodes.get(node)?.owners.includes(group), node + " must belong to " + group);
}

for (const section of ARCHITECTURE_SECTIONS)
{
	test(section.id + ": bounded labels, explicit ownership and no orphan notes", () =>
	{
		const diagram = graph(section.id);
		assert.ok(diagram.nodes.size > 1 && diagram.nodes.size <= 16, "Keep section graphs focused");
		assert.ok(diagram.edges.length <= 20, "Move fine-grained detail to the audited prose");
		assert.ok(diagram.groups.size >= 2, "Show responsibility or persistence boundaries");
		const depth = Math.max(...[...diagram.nodes.keys()].map((id) => longestPath(diagram, id)));
		assert.ok(depth <= (diagram.header === "flowchart LR" ? 9 : 6), "Avoid giant linear towers");
		for (const [id, node] of diagram.nodes)
		{
			const lines = node.label.split("<br/>");
			assert.ok(lines.length <= 3, id + ": too many label lines");
			for (const line of lines)
			{
				assert.ok(line.length > 0 && line.length <= 32, id + ": long or empty label line: " + line);
				assert.doesNotMatch(line, /[<>]/, id + ": use only plain text and br line breaks");
			}
			assert.ok(diagram.edges.some((link) => link.from === id || link.to === id), id + ": orphan / legend node");
		}
		for (const link of diagram.edges)
		{
			assert.ok(link.label.length > 0 && link.label.length <= 34, link.from + " -> " + link.to + ": long edge label");
			assert.notEqual(link.from, link.to, "Do not introduce layout-only self loops");
		}
		for (const id of diagram.groups.keys())
		{
			assert.ok([...diagram.nodes.values()].some((node) => node.owners.includes(id)), id + ": empty boundary");
		}
	});
}

// Check auth and architecture with the same grammar. A bidirectional link
// counts as an outgoing link at both ends.
const authSource = readFileSync(new URL("../auth-setup-flow.md", import.meta.url), "utf8")
	.match(/```mermaid\s*\n([\s\S]*?)```/)[1];
const auth = readGraph(authSource);
for (const [id, diagram] of [
	["auth", auth], ...ARCHITECTURE_SECTIONS.map(section => [section.id, graph(section.id)])
])
{
	test(id + ": only labeled decisions have multiple outgoing paths", () =>
	{
		for (const [key, node] of diagram.nodes)
		{
			const branches = diagram.edges.filter(e => e.from === key || (e.kind === "<-->" && e.to === key));
			if (branches.length < 2)
			{
				assert.ok(!node.decision, key + ": decision needs distinct outcomes");
				continue;
			}
			assert.ok(node.decision, key + ": non-decision node branches");
			assert.match(node.label, /\?$/);
			assert.equal(new Set(branches.map(e => e.label)).size, branches.length);
		}
	});
}

test("protected route restores the user only after refresh and profile success", () =>
{
	edge(auth, "Hint", "Refresh", /Yes/);
	edge(auth, "Hint", "Guard", /No/);
	edge(auth, "Refresh", "Profile", /200/);
	edge(auth, "Profile", "Ready", /200/);
	for (const request of ["Refresh", "Profile"])
	{
		edge(auth, request, "Clear", /401/);
		edge(auth, request, "Error", /Other failure/);
	}
	edge(auth, "Clear", "Guard");
	edge(auth, "Guard", "Setup");
	edge(auth, "Setup", "First", /True/);
	edge(auth, "Setup", "Login", /False/);
	edge(auth, "Setup", "Error", /failed/);
});

test("disconnect requires a user retry and offline navigation falls back only on rejection", () =>
{
	const socket = graph("alert-connection");
	edge(socket, "Connect", "Refresh", /Opened/);
	edge(socket, "Connect", "Retry", /before open/);
	edge(socket, "Refresh", "Event", /Listen/);
	edge(socket, "Event", "Update", /Message/);
	edge(socket, "Event", "Retry", /Close/);
	edge(socket, "Retry", "Connect", /User selects Retry/);
	const offline = graph("offline-navigation");
	edge(offline, "Read", "Page", /any HTTP status/);
	edge(offline, "Read", "Cache", /rejection/);
	edge(offline, "Cache", "Fallback");
});

test("public ingress, database writes and internal callbacks have distinct senders", () =>
{
	const g = graph("overview");
	for (const id of ["Producer", "Browser"]) owned(g, id, "Clients");
	for (const id of ["Ingest", "Collector", "CH", "Confirmed", "Callback", "API", "PG", "WAF", "LLM", "Ollama"]) owned(g, id, "Host");
	assert.ok(reaches(g, "Producer", "CH"));
	assert.ok(!reaches(g, "WAF", "Collector"));
	edge(g, "CH", "Confirmed", /count/);
	edge(g, "Confirmed", "Callback", /POST metadata/);
	assert.ok(reaches(g, "Browser", "PG"));
	assert.ok(reaches(g, "Job", "Ollama"));
});

test("storage freshness precedes event-time evaluation; silence is a scheduled check", () =>
{
	const g = graph("telemetry");
	assert.ok(reaches(g, "Receive", "Timer"));
	assert.match(g.nodes.get("Timer").label, /stored_at is newer/);
	edge(g, "Timer", "Window", /latest_timestamp/);
	edge(g, "Deadline", "Current");
	edge(g, "Current", "Silent", /Yes/);
	edge(g, "Current", "Stale", /No/);
	assert.ok(!reaches(g, "Window", "Silent"));
});

test("alert commits precede dispatch; worker completion never gates the callback", () =>
{
	assert.equal(ARCHITECTURE_SECTIONS.find(s => s.id === "delivery").diagram, ARCHITECTURE_DELIVERY_DIAGRAM);
	const g = graph("delivery");
	owned(g, "Commit", "AlertSave");
	owned(g, "Analysis", "AsyncWork");
	edge(g, "Exporter", "Evaluate", /POST :8081/);
	edge(g, "Trigger", "Commit", /Yes/);
	edge(g, "Trigger", "Done", /No new alerts/);
	edge(g, "Commit", "Dispatch", /After commit/);
	edge(g, "Dispatch", "Done", /no AI wait/);
	edge(g, "Job", "Analysis");
	assert.ok(!reaches(g, "Analysis", "Done"));
});

test("read queries do not persist rows, and alert history and recipients share one commit", () =>
{
	const g = graph("databases");
	owned(g, "CH", "TelemetryStore");
	owned(g, "Alerts", "AppStore");
	edge(g, "Query", "Rows", /Read-only/);
	assert.ok(!reaches(g, "Query", "CHVolume"));
	edge(g, "Save", "Alerts", /One commit/);
	edge(g, "Alerts", "PGVolume", /both together/);
	edge(g, "CH", "CHVolume");
	assert.ok(!reaches(g, "CH", "PGVolume"));
});

test("Caddy matches blocked paths before forwarding or serving the SPA", () =>
{
	const g = graph("deployment");
	assert.deepEqual(g.edges.filter(e => e.from === "Route").map(e => e.to),
		["Forbidden", "Hidden", "WAF", "Collector", "Static"]);
	assert.match(g.nodes.get("Forbidden").label, /403/);
	assert.match(g.nodes.get("Hidden").label, /404/);
	edge(g, "Route", "Collector", /strip prefix/);
	edge(g, "WAF", "API");
});

test("each fixed Vault role authenticates, reads its own document and renders a mounted file", () =>
{
	const g = graph("vault");
	edge(g, "Vault", "Roles");
	edge(g, "Roles", "Login", /Role ID and secret ID/);
	edge(g, "Login", "Read", /Role token/);
	edge(g, "Read", "Render");
	edge(g, "Render", "Mount", /Read-only/);
});

test("automatic analysis persists a result or fallback; questions only stream to the caller", () =>
{
	const g = graph("ai");
	assert.ok(reaches(g, "Saved", "Persist"));
	edge(g, "Result", "Unavailable", /failed/);
	edge(g, "Unavailable", "Persist");
	edge(g, "Persist", "Hooks", /still present/);
	assert.ok(reaches(g, "Ask", "Relay"));
	assert.ok(!reaches(g, "Ask", "Persist"));
	assert.ok(!reaches(g, "Ask", "Hooks"));
});

test("Compose all-of prerequisites and the independent model startup remain visible", () =>
{
	const g = graph("startup");
	edge(g, "Bootstrap", "Agents", /healthy/);
	edge(g, "PgGate", "PG");
	edge(g, "ChGate", "CH");
	edge(g, "CH", "Init", /Healthy/);
	assert.match(g.nodes.get("ApiGate").label, /API agent and both DBs healthy.*init completed/);
	assert.match(g.nodes.get("CollectorGate").label, /Collector agent healthy.*init completed/);
	edge(g, "ApiGate", "API");
	edge(g, "CollectorGate", "Collector");
	edge(g, "API", "WAF", /Started/);
	edge(g, "WAF", "Proxy", /healthy/);
	assert.match(g.nodes.get("Proxy").label, /API and.*Collector have also started/);
	edge(g, "Ollama", "Pull");
	edge(g, "Pull", "LLM", /successfully/);
	assert.ok(!reaches(g, "API", "Collector"));
	assert.ok(!reaches(g, "LLM", "API"));
});

test("callback retries distinguish 204, retryable errors, terminal responses and cancellation", () =>
{
	const g = graph("decisions");
	edge(g, "Result", "Complete", /204/);
	edge(g, "Result", "Retry", /5xx/);
	edge(g, "Result", "Failure", /Other HTTP/);
	edge(g, "Retry", "Wait", /three attempts/);
	edge(g, "Retry", "Failure", /No/);
	edge(g, "Wait", "Attempt", /Yes/);
	edge(g, "Wait", "Failure", /cancelled/);
	edge(g, "Failure", "Discard");
	assert.ok(!reaches(g, "Discard", "Attempt"));
	assert.equal(edge(g, "Backup", "Restore").kind, "-.->");
	assert.ok(!reaches(g, "Failure", "Backup"));
});
