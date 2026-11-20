export function indexAtlas(root)
{
	const nodes = new Map();
	function visit(node, ancestors)
	{
		nodes.set(node.id, { ...node, ancestors });
		for (const child of node.children) visit(child, [...ancestors, node.id]);
	}
	visit(root, []);
	return nodes;
}

export function getAtlasScope(nodes, selectedId)
{
	const selected = nodes.get(selectedId);
	// A leaf is inspected alongside its siblings, not on an empty canvas.
	return selected.children.length || !selected.ancestors.length
		? selected
		: nodes.get(selected.ancestors.at(-1));
}
