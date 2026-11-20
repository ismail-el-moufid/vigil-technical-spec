# Open atlas sources in your editor

Expand **Source evidence** under an atlas component, choose **Zed**, **VS Code**, **VSCodium**, or **GitHub**, and click a file path. Your editor choice is remembered in this browser. Native editor links use the editor’s registered URL handler; the browser may ask permission before opening the application. Install/register the chosen editor if its handler is unavailable, or use the separate GitHub link.

## Where local files come from

Run the development server from a normal terminal on the same machine as your editor:

```sh
npm run dev
```

The server derives the sibling `../vigil` checkout from this app’s project root. There are no hardcoded home-directory paths in the app. It verifies representative VIGIL files before treating a directory as a checkout and links only files in the atlas’s source catalog.

For a checkout elsewhere, set a **server-side** root before starting Vite:

```sh
VIGIL_SOURCE_ROOT=/path/to/your/vigil npm run dev
```

The path is chosen by the local operator, not supplied by browser requests. A relative value is resolved from the specification app’s project root. An invalid override is reported rather than silently replaced. Existing checkouts are never fetched, reset, modified, or deleted.

If no suitable sibling checkout exists, **Prepare source checkout in /tmp** explicitly downloads a shallow checkout of the public `ft-transcendence-vigil/vigil` repository’s `develop` branch. It uses a private directory under the operating system’s temporary directory, not your home directory. It requires Git and network access to GitHub, but no sudo. It does not install dependencies, build, or run project code. Concurrent requests share one preparation. A prepared checkout is reused by that Vite process; after a server restart or temporary-directory cleanup, preparation may be needed again. Failed preparation cleans only its own temporary directory.

Run Vite outside Flatpak/container filesystem isolation when opening files in a host-installed editor. A sandbox’s `/run/flatpak/doc/...` or container paths may not exist in the editor’s filesystem. This app cannot bypass that boundary or automatically detect every installed editor.

## Hosted/static builds

Normal HTTPS GitHub links remain usable without a local bridge. A browser-only checkout would live in browser storage, not in a folder a native editor can open. It would therefore still need a local companion to open native editor files; this app does not pretend to provide that access.

The GitHub fallback tracks `develop` and may differ from a local checkout’s branch or uncommitted changes.

## Security boundaries

- The bridge is development-only, bound by request checks to loopback clients, a loopback Host, and same-origin browser requests. It is unavailable in production and preview builds.
- There is no filesystem-path, repository-URL, shell-command, or editor-command input from the browser. Preparation accepts only an empty JSON object.
- Native URLs are generated from existing, regular, catalogued files whose real paths remain inside the verified checkout. Symlinks escaping it are omitted; missing files use GitHub instead.
- The bridge never launches a process to open a file. Clicking a native URL is an explicit browser/OS handoff to the selected editor.
- Clone arguments, repository, and branch are fixed server-side. Shell execution, Git hooks, inherited Git configuration, credential prompts, and checkout templates are disabled.
- No CORS access is granted. Responses are not cached. Absolute local paths appear only in local native-editor URLs, never baked into the production bundle.

## Tests

```sh
npm run test:sources
```

The bridge tests use temporary fixtures and a fake Git runner, not real network clones. Client tests cover URL encoding, protocol restrictions, editor preferences, static fallback, and the explicit preparation request.
