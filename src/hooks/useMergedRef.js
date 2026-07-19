import { useCallback, useRef } from "react";

/**
 * useMaskSpotlight/useBorderSpotlight each return a callback ref (a plain
 * function), not an object ref — that function IS the ref, there's no
 * `.current` on it. useCollapseHotkey's nodeRef param, on the other hand,
 * needs an object ref it can read `.current` off of (see its own comment:
 * "a ref already attached to this collapsible's own wrapper element").
 * Passing the spotlight's callback ref straight through as nodeRef silently
 * does nothing — `nodeRef?.current` on a function is just `undefined` — so
 * the sibling comparison in HotkeyScope always falls back to mount-order for
 * that item, even though a node is right there on screen.
 *
 * This merges the two: returns a stable callback ref to put on the element
 * (calls the spotlight's callback ref AND records the node), plus the object
 * ref to hand to useCollapseHotkey.
 *
 * The spotlight hooks return React 19-style ref-callbacks: calling them with
 * the node sets up listeners/observers/clones and hands back a cleanup
 * function, which React normally invokes itself on unmount or when the ref
 * callback's identity changes. Wrapping that callback ref inside another
 * function means React only ever sees OUR function's identity, so it's on
 * us to call the inner cleanup at the right time — return it from our own
 * callback so React treats it the same way it would have treated the
 * spotlight's ref directly. Skipping this (e.g. just calling callbackRef(el)
 * and dropping what it returns) leaves every mouseenter/mouseleave listener,
 * MutationObserver, and cloned glow element from the previous attach alive
 * and stacked underneath the new one — visible as ghosted duplicate text.
 *
 * Memoized on `callbackRef` alone, so it's only re-created when the
 * spotlight hook's own dependencies (isExpanded/border) change — same
 * cadence the spotlight hook already documents for its own listener
 * setup/teardown, not on every unrelated render.
 */
export default function useMergedRef(callbackRef)
{
	const nodeRef = useRef(null);
	const setRef = useCallback((el) =>
	{
		nodeRef.current = el;
		const cleanup = callbackRef(el);
		return () =>
		{
			nodeRef.current = null;
			cleanup?.();
		};
	}, [callbackRef]);
	return [setRef, nodeRef];
}
