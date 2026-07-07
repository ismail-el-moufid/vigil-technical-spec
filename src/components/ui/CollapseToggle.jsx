/**
 * CollapseToggle — the small control shown at the end of every collapsible
 * header: an open/closed arrow with, while a numbered hotkey is assigned to
 * this item (see HotkeyScope.jsx / useCollapseHotkey.js), a keycap-style badge for it sitting
 * right beside the arrow inside the same control.
 *
 * hotkeyNumber is only non-null for OPEN items that got one of the first 9
 * registration slots this render — closed items and 10th+ items show a bare
 * arrow, same as before hotkeys existed. The keycap shows the modifier
 * (⌘ on Mac, Ctrl elsewhere) since the shortcut is Cmd/Ctrl + digit, not
 * the bare digit.
 */
const MODIFIER_LABEL = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent ?? "")
	? "⌘"
	: "Ctrl+";

export default function CollapseToggle({
	collapsed,
	hotkeyNumber,
	className = ""
})
{
	return (
		<span className={"collapse-toggle" + (className ? " " + className : "")}>
			<span className="collapse-toggle-arrow">{collapsed ? "→" : "↓"}</span>
			{hotkeyNumber != null && (
				<kbd className="collapse-toggle-key" title={"Press " + MODIFIER_LABEL + hotkeyNumber + " to collapse"}>
					{MODIFIER_LABEL}{hotkeyNumber}
				</kbd>
			)}
		</span>
	);
}
