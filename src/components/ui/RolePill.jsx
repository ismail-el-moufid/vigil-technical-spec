/**
 * RolePill displays a role with appropriate styling.
 */
export default function RolePill({ role })
{
	const key = role.split(" +")[0].trim();
	const cls = "role--" + key.toLowerCase().replace(/\s+/g, "-");
	const pillClass = `role-pill ${cls}`;
	return (
		<span className={pillClass}>
			{role}
		</span>
	);
}
