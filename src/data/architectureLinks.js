import { ENDPOINTS, PAGES } from './index.js';
import { contractGroups, connectedPages, TOPICS } from './architectureStory.js';

export const SECTION_LINKS = new Map();
export const ITEM_TOPICS = new Map();

for (const topic of Object.keys(TOPICS))
{
	const groups = contractGroups(topic, ENDPOINTS);
	const screens = connectedPages(topic, groups, PAGES);
	SECTION_LINKS.set(topic, { groups, screens });
	const items = new Set([
	   ...screens,
	   ...groups.flatMap(group => group.endpoints)
	]);
	for (const item of items)
	{
		if (!ITEM_TOPICS.has(item.id)) ITEM_TOPICS.set(item.id, []);
		ITEM_TOPICS.get(item.id).push(topic);
	}
}
