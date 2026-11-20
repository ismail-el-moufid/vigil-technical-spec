import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const markdown = readFileSync(new URL("../auth-setup-flow.md", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/AuthFlowDiagram.jsx", import.meta.url), "utf8");
const FlowDiagram = () => null;

// Compile the real adapter, stubbing only its raw import and shared renderer so no DOM is needed.
const { code } = await transformWithOxc(
	component
		.replace(/^import authFlowMarkdown from [^;]+;\s*$/m, "")
		.replace(/^import FlowDiagram from [^;]+;\s*$/m, "")
		.replace("export default function AuthFlowDiagram", "function AuthFlowDiagram"),
	"AuthFlowDiagram.jsx",
	{ jsx: { runtime: "classic", pragma: "createElement", pragmaFrag: "Fragment" } },
);

function renderAuthFlow(source = markdown)
{
	return runInNewContext(code + "\nAuthFlowDiagram();", {
		authFlowMarkdown: source,
		FlowDiagram,
		createElement,
		Fragment,
	}, { timeout: 1000 });
}

function captionText()
{
	return renderToStaticMarkup(renderAuthFlow().props.description)
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");
}

test("auth delegates the unchanged markdown graph to the shared diagram", () =>
{
	const diagram = renderAuthFlow();
	assert.strictEqual(diagram.type, FlowDiagram);
	assert.equal(diagram.props.source, markdown.match(/```mermaid\s*\n([\s\S]*?)```/)[1]);
	assert.match(diagram.props.source, /^flowchart TD\b/);
	assert.match(diagram.props.title, /Authentication bootstrap and setup/);
});

test("auth accepts graph changes without requiring legacy node IDs or clusters", () =>
{
	const graph = "flowchart LR\n    Start[New entry] --> Finish[New result]\n";
	const diagram = renderAuthFlow("# Revised bootstrap\n\n```mermaid\n" + graph + "```\n");
	assert.strictEqual(diagram.type, FlowDiagram);
	assert.equal(diagram.props.source, graph);
});

test("missing or blank Mermaid graphs reach the shared missing-source fallback", () =>
{
	for (const source of ["", "# No graph", "```json\n{}\n```", "```mermaid\n```", "```mermaid\n  \t\n```"])
	{
		const diagram = renderAuthFlow(source);
		assert.strictEqual(diagram.type, FlowDiagram);
		assert.equal(diagram.props.source.trim(), "");
	}
});

test("captions distinguish bootstrap from reactive in-session refresh", () =>
{
	const caption = captionText();
	assert.match(caption, /Initial page load/);
	assert.match(caption, /not proof of authentication/);
	assert.match(caption, /Both refresh and GET \/api\/users\/me must succeed/);
	assert.match(caption, /No hint skips refresh/);
	assert.match(caption, /In-session requests \(not shown\)/);
	assert.match(caption, /one shared refresh promise and retries the request once/);
	assert.match(caption, /without rechecking the hint, proactively checking token expiry or refetching the user profile/);
});

test("captions preserve implemented cookie, failure and setup caveats", () =>
{
	const caption = captionText();
	assert.match(caption, /Missing refresh cookies fail before database lookup/);
	assert.match(caption, /empty values are hashed and looked up/);
	assert.match(caption, /refresh service-level 401 clears both cookies/);
	assert.match(caption, /Network failures, 429 and 5xx during bootstrap or setup status remain error\/retry states, not login redirects/);
	assert.match(caption, /GET \/api\/setup checks for no admins/);
	assert.match(caption, /POST \/api\/setup rejects any existing user/);
	assert.match(caption, /viewer-only database can report setup required but reject creation/);
	assert.match(caption, /concurrent setup is not serialized/);
});
