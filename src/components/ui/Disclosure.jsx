import { useId } from "react";
import useMaskSpotlight from "../../hooks/useMaskSpotlight";
import CollapseToggle from "./CollapseToggle";

export default function Disclosure({ label, count, open, onToggle, children })
{
	const id = useId();
	const border = useMaskSpotlight(open);
	return (
		<div className="spec-disclosure">
			<button type="button" ref={border} className="spec-disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={onToggle}>
				{label}
				{count != null && <span className="group-hd-count">{count}</span>}
				<CollapseToggle collapsed={!open} />
			</button>
			<div id={id} className={"collapsible" + (open ? " collapsible--open" : "")} inert={!open}>
				<div className="collapsible-inner">{children}</div>
			</div>
		</div>
	);
}
