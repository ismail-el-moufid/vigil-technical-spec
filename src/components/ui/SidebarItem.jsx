/**
 * SidebarItem displays a single item in the sidebar navigation.
 */

export default function SidebarItem({
	item,
	isActive,
	isEndpoint,
	onClick
})
{
	return (
		<div
			id={isEndpoint ? "nav-" + item.id : undefined}
			className={"sidebar-item" + (isActive ? " active" : "")}
			onClick={onClick}
		>
			{isEndpoint ? (
				<>
					<span
						className={"badge badge--" + item.method.toLowerCase()}
					>
						{item.method}
					</span>
					<span className="sidebar-item-route">
						{item.route}
					</span>
				</>
			) : (
				<>
					<span className="sidebar-item-name">
						{item.name}
					</span>
					<span
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 9,
							color: "var(--text2)",
						}}
					>
						{item.path}
					</span>
				</>
			)}
		</div>
	);
}
