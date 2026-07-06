import { useState, useEffect } from "react";
import { PAGES } from "../data";
import useOpenState from "../hooks/useOpenState.js";
import { HotkeyScope } from "../hooks/useCollapseHotkeys.jsx";
import groupBy from "../utils/groupBy.js";
import GroupSection from "../components/GroupSection.jsx";
import { PageCard } from "../components/EndpointComponents.jsx";

/**
 * PagesView displays all pages grouped by logical groups, with role statistics.
 */
export default function PagesView({ highlightPageId, highlightEndpointId })
{
	// Single-select open page — only one page card open at a time across the
	// whole view (accordion behaviour, intentional). Kept separate from the
	// openState registry so the collapse-all button can clear it independently.
	const [open, setOpen] = useState(highlightPageId || null);

	// Registry for every *other* collapsible thing: endpoint cards, payload
	// sections, used-by toggles, and nested page cards inside used-by lists.
	const [
	   openKeys,
	   isOpenState,
	   toggleOpenState,
	   ,
	   collapseMatching
	] = useOpenState();

	const [openGroups, , toggleGroup, ensureGroup, collapseGroups] = useOpenState();

	// --- Global collapse shortcuts ---------------------------------------
	// Esc       - "step" collapse: closes every currently-open item at the
	//             deepest open level, then walks up one level per press
	//             (nested payload/used-by -> the single open page -> groups).
	// Shift+Esc - collapses absolutely everything in one press.
	//
	// Depth model: groups sit at depth 0, the single open page at depth 1,
	// and every openKeys entry at depth (1 + colon count) — child keys are
	// always built as `parentKey + ":" + suffix` throughout this codebase,
	// so colon count already encodes nesting depth. Acting on every item
	// sharing the current max depth (not just one) also covers multiple
	// things open at the same level across different groups in one press.
	function collectOpenItems()
	{
		const items = [];
		for (const key of openGroups) items.push({ type: "group", key, depth: 0 });
		if (open) items.push({ type: "page", depth: 1 });
		for (const key of openKeys)
		{
			const depth = 1 + (key.split(":").length - 1);
			items.push({ type: "key", key, depth });
		}
		return items;
	}

	function collapseStep()
	{
		const items = collectOpenItems();
		if (items.length === 0) return;
		const maxDepth = Math.max(...items.map((i) => i.depth));
		const atMax = items.filter((i) => i.depth === maxDepth);

		if (atMax.some((i) => i.type === "page")) setOpen(null);
		const groupKeys = new Set(atMax.filter((i) => i.type === "group").map((i) => i.key));
		if (groupKeys.size) collapseGroups((k) => groupKeys.has(k));
		const plainKeys = new Set(atMax.filter((i) => i.type === "key").map((i) => i.key));
		if (plainKeys.size) collapseMatching((k) => plainKeys.has(k));
	}

	function collapseAll()
	{
		setOpen(null);
		collapseGroups(() => true);
		collapseMatching(() => true);
	}

	useEffect(() =>
	{
		function handleKeyDown(e)
		{
			if (e.key !== "Escape") return;
			const tag = document.activeElement?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			e.preventDefault();
			if (e.shiftKey) collapseAll();
			else collapseStep();
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openKeys, openGroups, open]);

	useEffect(() =>
	{
		if (highlightPageId)
		{
			const t = setTimeout(() =>
			{
				setOpen(highlightPageId);
			}, 0);
			const page = PAGES.find((p) => p.id === highlightPageId);
			if (page?.group) ensureGroup(page.group);
			return () => clearTimeout(t);
		}
	}, [highlightPageId, ensureGroup]);

	const groups = groupBy(PAGES);

	return (
		<div>
			<div className="panel-title">Pages</div>
			<div className="panel-sub">
				{PAGES.length} routes in the application
				<span className="panel-sub-shortcuts">
					<kbd>Esc</kbd> collapse one level · <kbd>Shift</kbd>+<kbd>Esc</kbd> collapse all · <kbd>1</kbd>-<kbd>9</kbd> collapse item
				</span>
			</div>

			<HotkeyScope>
				{[...groups].map(([group, pages]) =>
				{
					const pageIds = pages.map((p) => p.id);
					const extraOpenCount = pageIds.includes(open) ? 1 : 0;
					const onCollapseExtra = pageIds.includes(open) ? () => setOpen(null) : undefined;

					return (
						<GroupSection
							key={group}
							group={group}
							items={pages}
							openGroups={openGroups}
							toggleGroup={toggleGroup}
							openKeys={openKeys}
							collapseMatching={collapseMatching}
							extraOpenCount={extraOpenCount}
							onCollapseExtra={onCollapseExtra}
						>
							{pages.map((page) =>
							{
								const isPageOpen = open === page.id;
								return (
									<PageCard
										key={page.id}
										page={page}
										isOpen={isPageOpen}
										onToggle={() => setOpen(isPageOpen ? null : page.id)}
										keyPrefix={"page:" + page.id}
										isOpenState={isOpenState}
										toggleOpenState={toggleOpenState}
										highlightEndpointId={highlightEndpointId}
										openKeys={openKeys}
										collapseMatching={collapseMatching}
									/>
								);
							})}
						</GroupSection>
					);
				})}
			</HotkeyScope>
		</div>
	);
}
