/**
 * Badge component displays HTTP method with appropriate styling.
 */
export default function Badge({ method })
{
	const badgeClass = `badge badge--${method.toLowerCase()}`;
	return (
		<span className={badgeClass}>
			{method}
		</span>
	);
}
