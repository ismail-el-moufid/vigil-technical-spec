import { useState, useCallback } from "react";

/**
 * Unified open/closed registry for all collapsible state — endpoint cards,
 * payload sections, used-by toggles, nested page cards, and group toggles.
 *
 * Supersedes `useToggleSet`: the `ensure` function and optional `initial`
 * seed cover everything useToggleSet did, and `collapseMatching` + `isOpen`
 * cover what useOpenState added on top.
 *
 * Keys are plain strings. There is no enforced schema; `collapseMatching`
 * does a substring test, so callers own building keys that (a) are unique
 * per-instance and (b) share a recognisable fragment (a page id, an
 * endpoint id) that group-collapse can key off.
 *
 * @param {Array} initial - Optional seed keys (e.g. pre-opened groups)
 * @returns {[Set, (key:string)=>boolean, (key:string)=>void, (key:string)=>void, (test:(key:string)=>boolean)=>void]}
 *   [set, isOpen, toggle, ensure, collapseMatching]
 */
export default function useOpenState(initial = [])
{
	const [set, setSet] = useState(() => new Set(initial));

	const isOpen = useCallback((key) => set.has(key), [set]);

	const toggle = useCallback((key) => setSet((prev) =>
	{
		const next = new Set(prev);
		next.has(key) ? next.delete(key) : next.add(key);
		return next;
	}), []);

	// Adds key only if absent — safe to call repeatedly (e.g. on highlight
	// effects that fire more than once).
	const ensure = useCallback((key) => setSet((prev) =>
		prev.has(key) ? prev : new Set([...prev, key])
	), []);

	// Removes every currently-open key for which `test(key)` returns true.
	// Group-level "collapse all" buttons call this with a predicate that
	// matches keys belonging to that group (by id substring), collapsing
	// every open section at any nesting depth in one state update.
	const collapseMatching = useCallback((test) => setSet((prev) =>
	{
		let changed = false;
		const next = new Set(prev);
		for (const key of prev)
		{
			if (test(key))
			{
				next.delete(key);
				changed = true;
			}
		}
		return changed ? next : prev;
	}), []);

	return [set, isOpen, toggle, ensure, collapseMatching];
}
