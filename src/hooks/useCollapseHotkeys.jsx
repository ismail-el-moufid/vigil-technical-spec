import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Per-collapsible numbered hotkeys.
 *
 * Wrap a view's content in <HotkeyScope>, then have any collapsible call
 * useCollapseHotkey(isOpen, onCollapse) unconditionally on every render. Open
 * collapsibles register themselves in render order (which matches visual
 * top-to-bottom order for this codebase's layouts) and get back a number
 * 1-9 to show as a small badge; pressing Cmd/Ctrl + that digit collapses
 * just that one item, wherever it lives in the tree. Plain digit presses
 * are left alone (they're needed for typing in inputs and don't collide
 * with anything else in the app).
 *
 * Registration happens during render (not an effect): <HotkeyScope> resets
 * a shared ref to [] at the top of its own render, which — because React
 * renders a parent's function body before it renders the children passed to
 * it as JSX — always runs before any descendant's useCollapseHotkey call for
 * the same pass. The keydown handler is attached once and reads the ref's
 * *current* value at event time, so it's never working off a stale list.
 *
 * Only the first 9 open collapsibles registered in a given render get a
 * number (there are only 9 digit keys) — anything past that just renders
 * without a badge, same as being outside a HotkeyScope entirely.
 */
const HotkeyContext = createContext(null);

export function HotkeyScope({ children })
{
	const registryRef = useRef([]);
	registryRef.current = [];

	useEffect(() =>
	{
		function handleKeyDown(e)
		{
			if (!/^[1-9]$/.test(e.key)) return;
			if (!(e.metaKey || e.ctrlKey)) return;
			const tag = document.activeElement?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			const entry = registryRef.current[Number(e.key) - 1];
			if (!entry) return;
			e.preventDefault();
			entry.collapse();
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<HotkeyContext.Provider value={registryRef}>
			{children}
		</HotkeyContext.Provider>
	);
}

// Call unconditionally, every render. Returns a number (1-9) to display as a
// hotkey badge, or null when closed, 10th+ open item this render, or there's
// no enclosing HotkeyScope.
export function useCollapseHotkey(isOpen, onCollapse)
{
	const registryRef = useContext(HotkeyContext);
	if (!registryRef || !isOpen) return null;
	const number = registryRef.current.length + 1;
	registryRef.current.push({ collapse: onCollapse });
	return number <= 9 ? number : null;
}