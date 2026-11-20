import assert from 'node:assert/strict';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SYSTEM_ATLAS } from '../src/data/systemAtlas.js';
import { getAtlasScope, indexAtlas } from '../src/utils/systemAtlas.js';

const vigil = fileURLToPath(new URL('../../vigil/', import.meta.url));

function visit(node, callback, ancestors = [])
{
	callback(node, ancestors);
	for (const child of node.children)
	{
		visit(child, callback, [...ancestors, node.id]);
	}
}

test('atlas is a finite tree with unique stable IDs and populated metadata', () =>
{
	const ids = new Set();
	const objects = new Set();
	function validate(node)
	{
		assert.ok(node && typeof node === 'object');
		assert.ok(!objects.has(node), 'cycle or shared child');
		objects.add(node);
		assert.match(node.id, /^[a-z][a-z0-9-]*$/);
		assert.ok(!ids.has(node.id), `duplicate ID: ${node.id}`);
		ids.add(node.id);
		for (const field of ['title', 'description', 'source'])
		{
			assert.equal(typeof node[field], 'string', `${node.id}.${field}`);
			assert.ok(node[field].trim(), `${node.id}.${field} is empty`);
		}
		assert.ok(Array.isArray(node.children), `${node.id}.children`);
		node.children.forEach(validate);
	}
	validate(SYSTEM_ATLAS);
	assert.equal(SYSTEM_ATLAS.id, 'vigil');
	assert.ok(SYSTEM_ATLAS.children.length > 0);
});

test('every semicolon-separated source exists inside the sibling vigil repository', () =>
{
	const root = realpathSync(vigil);
	visit(SYSTEM_ATLAS, (node) =>
	{
		for (const entry of node.source.split(';'))
		{
			const source = entry.trim();
			assert.ok(source, `${node.id}: empty source`);
			assert.ok(!isAbsolute(source), `${node.id}: absolute source`);
			const path = realpathSync(resolve(root, source));
			const local = relative(root, path);
			assert.ok(local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local), `${node.id}: escaping source`);
			assert.ok(statSync(path).isFile(), `${node.id}: source is not a file: ${source}`);
		}
	});
});

test('planned nodes explicitly distinguish proposals from implementation', () =>
{
	visit(SYSTEM_ATLAS, (node) =>
	{
		if (node.id.endsWith('-planned'))
		{
			assert.match(node.title, /^Planned:/);
			assert.match(node.description, /Proposed, not (deployed|implemented)/);
		}
	});
});

test('index preserves all hierarchy, breadcrumbs and evidence without mutating data', () =>
{
	const before = JSON.stringify(SYSTEM_ATLAS);
	const nodes = indexAtlas(SYSTEM_ATLAS);
	let count = 0;
	visit(SYSTEM_ATLAS, (node, ancestors) =>
	{
		count++;
		const indexed = nodes.get(node.id);
		assert.deepEqual(indexed.ancestors, ancestors);
		assert.equal(indexed.source, node.source);
		assert.equal(indexed.description, node.description);
		assert.deepEqual(indexed.children.map(({ id }) => id), node.children.map(({ id }) => id));
	});
	assert.equal(nodes.size, count);
	assert.equal(JSON.stringify(SYSTEM_ATLAS), before);
});

test('groups reveal their children while inspecting a leaf preserves sibling context', () =>
{
	const nodes = indexAtlas(SYSTEM_ATLAS);
	visit(SYSTEM_ATLAS, (node, ancestors) =>
	{
		const scope = getAtlasScope(nodes, node.id);
		if (node.children.length || !ancestors.length)
		{
			assert.equal(scope.id, node.id);
		}
		else
		{
			assert.equal(scope.id, ancestors.at(-1));
			assert.ok(scope.children.some(({ id }) => id === node.id));
			assert.ok(scope.children.length > 0, `${node.id}: leaf must not open an empty diagram`);
		}
	});
});

test('scope handles a leaf root and arbitrary child counts', () =>
{
	for (const count of [0, 1, 2, 3, 4, 5, 9, 10])
	{
		const tree = {
			id: 'root',
			children: Array.from({ length: count }, (_, index) => ({ id: `child-${index}`, children: [] })),
		};
		const nodes = indexAtlas(tree);
		assert.equal(nodes.size, count + 1);
		assert.equal(getAtlasScope(nodes, 'root').id, 'root');
		for (const child of tree.children) assert.equal(getAtlasScope(nodes, child.id).id, 'root');
	}
});
