// ─── REF NAV ───────────────────────────────────────────────────────────────
// RefText renders inline pills for cross-references (endpoint ids, auth
// strategy ids). Clicking one needs to open + scroll to the target, but the
// target's expand/scroll machinery lives at very different levels of the
// tree (EndpointsView for "ep-*", App/SecurityReference for "gw-strat-*")
// while RefText itself is mounted arbitrarily deep inside data-driven
// content. Rather than drill an onNavigate callback through every
// intermediate component, App registers a single handler here on mount and
// RefText calls it directly.

let handler = null;

export function setRefNavHandler(fn)
{
	handler = fn;
}

export function navigateToRef(id)
{
	if (handler) handler(id);
}
