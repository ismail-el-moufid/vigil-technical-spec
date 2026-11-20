import authFlowMarkdown from "../../auth-setup-flow.md?raw";
import FlowDiagram from "./FlowDiagram";

const authFlowSource = authFlowMarkdown.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1] ?? "";

export default function AuthFlowDiagram()
{
	return (
		<FlowDiagram
			source={authFlowSource}
			title="Authentication bootstrap and setup"
			description={
				<>
					<strong>Initial page load.</strong> Access tokens live in memory. The <code>session_hint</code> cookie
					only decides whether to attempt refresh; it is not proof of authentication. Both refresh and
					{" "}<code>GET /api/users/me</code> must succeed to restore the session. No hint skips refresh and
					leads through the unauthenticated guards to setup/login selection.
					<br /><br />
					<strong>In-session requests (not shown).</strong> <code>apiFetch</code> reacts to an HTTP <code>401</code>
					{" "}with one shared refresh promise and retries the request once, without rechecking the hint,
					proactively checking token expiry or refetching the user profile.
					<br /><br />
					<strong>Cookies and failures.</strong> Missing refresh cookies fail before database lookup;
					empty values are hashed and looked up. A refresh service-level <code>401</code> clears both cookies.
					Network failures, <code>429</code> and <code>5xx</code> during bootstrap or setup status remain
					error/retry states, not login redirects.
					<br /><br />
					<strong>Setup caveat.</strong> <code>GET /api/setup</code> checks for no admins, but <code>POST /api/setup</code>
					{" "}rejects any existing user. A viewer-only database can report setup required but reject creation;
					concurrent setup is not serialized.
				</>
			}
		/>
	);
}
