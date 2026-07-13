import { useEffect, useMemo, useRef, useState } from "react";
import { HotkeyApiContext, HotkeyNumberContext } from "./useCollapseHotkey";
import { isPhone } from "../utils/device.js";

/**
 * Per-collapsible numbered hotkeys.
 *
 * Wrap a view's content in <HotkeyScope>, then have any collapsible call
 * useCollapseHotkey(isOpen, onCollapse) unconditionally on every render. Each
 * collapsible claims a stable slot the first time it mounts, in mount order —
 * which matches visual top-to-bottom order for this codebase's layouts, and
 * stays fixed for that instance's lifetime even as it opens and closes later.
 * Currently-open collapsibles are renumbered 1-9 by slot order and get back a
 * number to show as a small badge; pressing Cmd/Ctrl + that digit collapses
 * whichever item currently holds that number, wherever it lives in the tree.
 * Plain digit presses are left alone (they're needed for typing in inputs and
 * don't collide with anything else in the app).
 *
 * Registration lives entirely in effects and state, never in a ref mutated
 * during render. An earlier version reset a shared ref to [] at the top of
 * <HotkeyScope>'s render and had descendants push into it during their own
 * render, relying on parent-before-child render order. That's not allowed —
 * React (and the React Compiler's static checks) only sanction writing to a
 * ref during render for one-time lazy init, i.e.
 * `if (ref.current === null) { ref.current = ... }`, and that exception
 * doesn't fit what we need here (resetting on *every* render). It was also
 * quietly broken under Strict Mode, which intentionally re-invokes render
 * functions in development to surface exactly this kind of impure side
 * effect — every open collapsible was registering itself twice.
 *
 * Only the first 9 currently-open collapsibles (by slot order) get a number
 * (there are only 9 digit keys) — anything past that just renders without a
 * badge, same as being outside a HotkeyScope entirely.
 *
 * The hook itself (useCollapseHotkey) and the contexts it reads live in
 * ./useCollapseHotkey.js, not here — this file exports only the component so
 * Fast Refresh can treat it as a clean boundary.
 */
export function HotkeyScope({ children })
{
	// id -> { isOpen, collapse }
	const [entries, setEntries] = useState(() => new Map());

	const api = useMemo(() => (
		{
			mount(id, isOpen, collapse)
			{
				setEntries(prev =>
				{
					const next = new Map(prev);
					next.set(id, { isOpen, collapse });
					return next;
				});
			},
			unmount(id)
			{
				setEntries(prev =>
				{
					if (!prev.has(id)) return prev;
					const next = new Map(prev);
					next.delete(id);
					return next;
				});
			},
			update(id, isOpen, collapse)
			{
				setEntries(prev =>
				{
					const current = prev.get(id);
					if (!current) return prev;
					if (current.isOpen === isOpen && current.collapse === collapse) return prev;
					const next = new Map(prev);
					next.set(id, { isOpen, collapse });
					return next;
				});
			},

		}), []);

	// Currently-open ids in slot order (lower id mounted earlier).
	const numberedIds = useMemo(() =>
	{
		return [...entries.keys()]
			.filter(id => entries.get(id).isOpen)
			.sort((a, b) => a - b)
			.slice(0, 9);
	}, [entries]);

	const numberOf = useMemo(() =>
	{
		return id =>
		{
			const index = numberedIds.indexOf(id);
			return index === -1 ? null : index + 1;
		};
	}, [numberedIds]);

	// Live snapshot for the keydown handler below, so it can resolve the
	// right collapse callback without re-attaching the window listener every
	// time numbering or entries change.
	const liveRef = useRef({ numberedIds, entries });
	useEffect(() =>
	{
		liveRef.current = { numberedIds, entries };
	});

	useEffect(() =>
	{
		if (isPhone) return;
		function handleKeyDown(e)
		{
			if (!/^[1-9]$/.test(e.key)) return;
			if (!(e.metaKey || e.ctrlKey)) return;
			const tag = document.activeElement?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			// Claim the combo now, before checking for a match. Browsers bind
			// Cmd/Ctrl+1-9 to tab switching natively; if we wait to call this
			// until after confirming a registered item exists, every press for
			// a currently-unused slot (fewer items open than the digit, or an
			// item just collapsed and the list shifted) falls through to the
			// browser instead of being a no-op inside the app.
			e.preventDefault();
			const { numberedIds, entries } = liveRef.current;
			const id = numberedIds[Number(e.key) - 1];
			if (id === undefined) return;
			const entry = entries.get(id);
			if (!entry) return;
			entry.collapse();
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<HotkeyApiContext.Provider value={api}>
			<HotkeyNumberContext.Provider value={numberOf}>
				{children}
			</HotkeyNumberContext.Provider>
		</HotkeyApiContext.Provider>
	);
}
