import { resolveRef } from "../../utils/refIndex.js";
import { navigateToRef } from "../../utils/refNav.js";

/**
 * RefText renders a piece of spec prose that may carry one or more
 * cross-references to other rendered spec elements (an endpoint, an auth
 * strategy). Per the Cross-Reference Policy, the prose itself never names
 * the other file/endpoint/strategy inline.
 *
 * Two ref shapes:
 * - a bare id string — just a link: resolves to a label (route / tag) and
 *   jumps to the full entry on click. Used where the citing text already
 *   restates the relevant fact itself, so the ref is a convenience
 *   cross-link, not the reader's only way to learn something.
 * - `{ id, field }` — a fact-level reference: `field` is pulled off the
 *   referenced entry's own data and rendered as real inline text (quoted),
 *   right after the sentence that cites it, so the fact itself is present
 *   without navigating anywhere. The jump-to-full-entry pill still follows
 *   it, for whoever wants the full surrounding context.
 *
 * value: string | { text: string, refs?: (string | { id: string, field: string })[] }
 */
export default function RefText({ value })
{
	const text = typeof value === "string" ? value : value.text;
	const refs = typeof value === "string" ? [] : value.refs || [];

	return (
		<>
			{text}
			{refs.map((ref, i) =>
			{
				const { id, label, fact } = resolveRef(ref);
				return (
					<span key={id + i} className="ref-inline">
						{fact && (
							<span className="ref-inline__fact">
								{" — "}<q>{fact}</q>
							</span>
						)}
						<button
							type="button"
							className="ref-pill"
							onClick={(e) =>
							{
								e.stopPropagation();
								navigateToRef(id);
							}}
							title={fact ? `Jump to ${label}` : undefined}
						>
							↪ {label}
						</button>
					</span>
				);
			})}
		</>
	);
}
