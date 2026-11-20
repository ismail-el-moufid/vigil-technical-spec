import assert from 'node:assert/strict';
import test from 'node:test';
import { flowRoutes, getConnectorDuration, getDiagramScale, startArrowSequence } from '../src/utils/flowDiagram.js';

test('readable view never makes configured 16px labels smaller than 14px', () =>
{
	for (const width of [200, 800, 1600, 3200])
	{
		for (const viewport of [320, 760, 1200])
		{
			const scale = getDiagramScale(width, viewport, "readable");
			assert.ok(scale >= 0.875 && scale <= 1);
			assert.ok(16 * scale >= 14);
		}
	}
});

test('the default fits the full available width at desktop and mobile sizes', () =>
{
	assert.equal(getDiagramScale(2000, 400, 'fit'), 0.2);
	assert.equal(getDiagramScale(2000, 400, 'actual'), 1);
	for (const viewport of [320, 760, 1280])
	{
		for (const width of [200, 1200, 3200])
		{
			assert.equal(width * getDiagramScale(width, viewport), viewport);
		}
	}
	assert.equal(getDiagramScale(200, 800, 'fit'), 4);
	assert.equal(getDiagramScale(0, 400), 1);
	assert.equal(getDiagramScale(400, 0), 1);
});

test('stopping animation clears every active spotlight, including under reduced motion', () =>
{
	const previous = { window: globalThis.window, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
	try
	{
		const circle = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
		const path = {
			getAttribute: () => 'edge',
			getTotalLength: () => 100,
			dataset: { spotlightCircle: 'circle' },
		};
		const svg = { classList: { toggle() {}, remove() {} }, querySelectorAll: () => [path], querySelector: () => circle };
		globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
		globalThis.requestAnimationFrame = () => assert.fail('reduced motion must not schedule animation');
		globalThis.cancelAnimationFrame = () => {};
		const stop = startArrowSequence(svg, [{ id: 'edge' }]);
		circle.attributes.opacity = '1';
		stop();
		assert.equal(circle.attributes.opacity, '0');
	}
	finally
	{
		globalThis.window = previous.window;
		globalThis.requestAnimationFrame = previous.raf;
		globalThis.cancelAnimationFrame = previous.cancel;
	}
});

test('branches replay their entire prefix and finish before the next branch', () =>
{
	const edges = [
		['entry', 'check'], ['check', 'profile'], ['check', 'guard'],
		['profile', 'done'], ['guard', 'setup'], ['guard', 'login']
	].map(([start, end]) => ({ start, end, id: start + '/' + end }));
	assert.deepEqual([...flowRoutes(edges)], [
		'entry/check', 'check/profile', 'profile/done',
		'entry/check', 'check/guard', 'guard/setup',
		'entry/check', 'check/guard', 'guard/login'
	]);
});

test('closed retry loops end at their entry and disconnected loops still play', () =>
{
	const edges = [['A','B'], ['B','A'], ['X','Y'], ['Y','X']]
		.map(([start,end]) => ({ start, end, id: start + end }));
	assert.deepEqual([...flowRoutes(edges)], ['AB','BA','XY','YX']);
});

test('small diagrams give short connectors more reading time without speeding up long paths', () =>
{
	assert.equal(getConnectorDuration(120, 3), 1500);
	assert.equal(getConnectorDuration(120, 6), 1200);
	assert.equal(getConnectorDuration(120, 16), 450);
	assert.equal(getConnectorDuration(720, 3), 2000);
	assert.equal(getConnectorDuration(720, 16), 2000);
});

test('the spotlight reaches the end of each SVG path before it starts the next branch', () =>
{
	const originals = {
		window: globalThis.window,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame
	};
	const edges = [
		{ start: 'load', end: 'decision', id: 'entry' },
		{ start: 'decision', end: 'setup', id: 'setup' },
		{ start: 'decision', end: 'login', id: 'login' }
	];
	const samples = [];
	const circles = new Map();
	const paths = edges.map(({ id }) =>
	{
		circles.set('#' + id, { setAttribute() {} });
		return {
			dataset: { spotlightCircle: id },
			getAttribute: () => id,
			getTotalLength: () => 120,
			getPointAtLength(distance)
			{
				samples.push({ id, distance });
				return { x: distance, y: distance * distance / 120 };
			}
		};
	});
	const svg = {
		querySelectorAll: () => paths,
		querySelector: selector => circles.get(selector),
		classList: { toggle() {}, remove() {} }
	};
	let frame;
	let stop;
	try
	{
		globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
		globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
		globalThis.cancelAnimationFrame = () => { frame = null; };
		stop = startArrowSequence(svg, edges);
		for (let time = 0; time <= 6300; time += 16) frame(time);
		assert.deepEqual(samples.filter(({ distance }) => distance === 120).map(({ id }) => id),
			['entry', 'setup', 'entry', 'login']);
		assert.deepEqual(samples.filter(({ distance }) => distance === 0).map(({ id }) => id),
			['entry', 'setup', 'entry', 'login', 'entry']);
		assert.ok(samples.some(({ distance }) => distance > 0 && distance < 120));
	}
	finally
	{
		stop?.();
		Object.assign(globalThis, originals);
	}
});
