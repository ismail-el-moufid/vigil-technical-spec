import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isPhone } from "../utils/device.js";

/**
 * Contexts and hook half of the collapse-hotkey system. Split out of
 * HotkeyScope.jsx so this file exports nothing but non-component values —
 * mixing a component export with a hook/constants export in one file
 * disables Fast Refresh for that file (React can't tell which export is the
 * "component boundary" to preserve state for on edit, so it falls back to a
 * full remount). HotkeyScope.jsx imports HotkeyApiContext and
 * HotkeyNumberContext from here to provide them.
 */

// Stable: mount/unmount/update methods children call from their own effects.
// This context's value never changes identity, so consuming it never forces
// an unrelated re-registration.
export const HotkeyApiContext = createContext(null);

// Volatile: id -> current badge number (or null). Kept separate from the api
// context so a renumbering — triggered whenever any sibling opens or closes —
// only re-runs the render-time lookup in HotkeyScope, not every collapsible's
// mount/unmount effect.
export const HotkeyNumberContext = createContext(() => null);

let nextId = 0;

// Call unconditionally, every render. Returns a number (1-9) to display as a
// hotkey badge, or null when closed, 10th+ open item this render, or there's
// no enclosing HotkeyScope.
export function useCollapseHotkey(isOpen, onCollapse)
{
	const api = useContext(HotkeyApiContext);
	const numberOf = useContext(HotkeyNumberContext);
	const [id] = useState(() => nextId++);

	// Always calls the latest onCollapse without requiring callers to
	// memoize it — the previous version re-read the plain argument fresh
	// every render too.
	const collapseRef = useRef(onCollapse);
	useEffect(() =>
	{
		collapseRef.current = onCollapse;
	});
	const stableCollapse = useMemo(() => () => collapseRef.current(), []);

	useLayoutEffect(() =>
	{
		if (!api) return;
		api.mount(id, isOpen, stableCollapse);
		return () => api.unmount(id);
		// isOpen/stableCollapse intentionally excluded: this effect only
		// handles this instance's mount/unmount; the effect below handles
		// every later change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [api, id]);

	useLayoutEffect(() =>
	{
		if (!api) return;
		api.update(id, isOpen, stableCollapse);
	}, [api, id, isOpen, stableCollapse]);

	// No keyboard on phones (in general) to press Cmd/Ctrl+digit with, so
	// don't bother surfacing a badge there.
	if (!api || !isOpen || isPhone) return null;
	return numberOf(id);
}
