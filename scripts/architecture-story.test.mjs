import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCHITECTURE_SECTIONS, ENDPOINTS, PAGES } from '../src/data/index.js';
import { SYSTEM_ATLAS } from '../src/data/systemAtlas.js';
import { indexAtlas } from '../src/utils/systemAtlas.js';
import { CONNECTIONS, INCIDENT, TOPICS } from '../src/data/architectureStory.js';
import { ITEM_TOPICS, SECTION_LINKS } from '../src/data/architectureLinks.js';

test('the four incident chapters follow stored telemetry through to independent analysis', () =>
{
	assert.deepEqual(INCIDENT.map(beat => beat.section), ['telemetry', 'delivery', 'alert-connection', 'ai']);
	assert.match(INCIDENT[0].text, /visible before/);
	assert.match(INCIDENT[1].text, /no open alert/);
	assert.match(INCIDENT[2].text, /Retry/);
	assert.match(INCIDENT[3].text, /offline/);
});

test('every architecture topic has a diagram, an atlas destination and distinct named connections', () =>
{
	assert.deepEqual(new Set(Object.keys(TOPICS)), new Set(ARCHITECTURE_SECTIONS.map(section => section.id)));
	const atlas = indexAtlas(SYSTEM_ATLAS);
	const pairs = new Set();
	for (const [id, [, atlasId]] of Object.entries(TOPICS))
	{
		assert.ok(atlas.has(atlasId), id);
		assert.ok(CONNECTIONS.some(([a, b]) => a === id || b === id), id);
	}
	for (const [a, b, label, reason] of CONNECTIONS)
	{
		assert.ok(TOPICS[a] && TOPICS[b] && a !== b);
		assert.ok(label && reason);
		const key = [a, b].sort().join('/');
		assert.ok(!pairs.has(key), key);
		pairs.add(key);
	}
});

test('source contracts, shared screens and reverse links describe exactly the same membership', () =>
{
	const catalog = [...ENDPOINTS, ...PAGES];
	for (const [topic, { groups, screens }] of SECTION_LINKS)
	{
		assert.ok(groups.every(group => group.endpoints.length));
		const linked = new Set([...groups.flatMap(group => group.endpoints), ...screens]);
		for (const item of catalog)
			assert.equal(ITEM_TOPICS.get(item.id)?.includes(topic) ?? false, linked.has(item), topic + '/' + item.id);
	}
	for (const id of ['ep-llm-analyze', 'page-ai', 'page-status']) assert.equal(ITEM_TOPICS.has(id), false);
	assert.ok(ITEM_TOPICS.get('page-settings-account').includes('alert-connection'), 'shared dashboard socket');
	assert.ok(ITEM_TOPICS.get('ep-alerts-trigger-evaluation').includes('telemetry'));
	assert.ok(!ITEM_TOPICS.get('ep-alerts-list').includes('offline-navigation'));
	const storage = SECTION_LINKS.get('databases').groups;
	for (const endpoint of ENDPOINTS)
		assert.deepEqual(storage.filter(group => group.endpoints.includes(endpoint)).map(group => group.label).sort(), [...endpoint.tables].sort());
});
