# Authentication and Setup Flow

The frontend should reuse an **unexpired access token** and call refresh only when it is missing or expired. Since the spec stores access tokens **in memory only**, a hard reload still takes the refresh path.

Refresh is responsible only for renewing an authenticated session. It does not determine whether initial setup is required. When refresh returns `401`, the frontend calls the separate unauthenticated `GET /api/setup/status` endpoint. That endpoint returns `setupRequired: true` when initial setup has not been completed and `false` otherwise.

```mermaid
flowchart LR
    subgraph FRONTEND["Frontend"]
        A["Auth guard"] --> Q{"Unexpired access token in memory?"}
        Q --- Q_YES@{ shape: text, label: "Yes" } --> D["Continue into app"]
        Q --- Q_REFRESH@{ shape: text, label: "No: missing or expired" } --> B["POST /api/auth/refresh"]
        C{"Refresh result"} --- C_NETWORK@{ shape: text, label: "Network failure" } --> H["Show error or retry state"]
        C --- C_200@{ shape: text, label: "200" } --> S["Store new access token in memory"]
        S --> D
        C --- C_401@{ shape: text, label: "401" } --> P["GET /api/setup/status"]
        C --- C_ERROR@{ shape: text, label: "429 or 5xx" } --> H["Show error or retry state"]
        P --- P_NETWORK@{ shape: text, label: "Network failure" } --> H
        U{"Setup-status response"} --- U_SETUP@{ shape: text, label: "200, setupRequired: true" } --> F["Show /setup"]
        U --- U_LOGIN@{ shape: text, label: "200, setupRequired: false" } --> G["Show /login"]
        U --- U_ERROR@{ shape: text, label: "429 or 5xx" } --> H
    end

    subgraph BACKEND["Backend"]
        T{"Non-empty refresh cookie?"} --- T_YES@{ shape: text, label: "Yes" } --> V{"Cookie valid?"}
        T --- T_EMPTY@{ shape: text, label: "No: missing or empty" } --> R_UNAUTHORIZED["401 Unauthorized"]
        V --- V_YES@{ shape: text, label: "Yes" } --> R_SUCCESS["200 with access token"]
        V --- V_INVALID@{ shape: text, label: "No: invalid, expired or revoked" } --> R_UNAUTHORIZED
        V --- V_ERROR@{ shape: text, label: "Rate limit or server failure" } --> R_ERROR["429 or 5xx"]
        R_SUCCESS --> R["Return refresh response"]
        R_UNAUTHORIZED --> R
        R_ERROR --> R

        N{"Initial setup completed?"}
        N --- N_NO@{ shape: text, label: "No" } --> ST_SETUP["200 with setupRequired: true"]
        N --- N_YES@{ shape: text, label: "Yes" } --> ST_LOGIN["200 with setupRequired: false"]
        N --- N_DATABASE@{ shape: text, label: "Database failure" } --> ST_ERROR["5xx"]
        ST_SETUP --> SR["Return setup-status response"]
        ST_LOGIN --> SR
        ST_ERROR --> SR
    end

    B --> T
    R --> C
    P --> N
    SR --> U

    linkStyle default stroke:white;
```

An empty cookie value follows the missing-cookie path even if the cookie header is present. A non-empty but invalid, expired, or revoked refresh cookie cannot restore the session: refresh returns an ordinary `401`, after which the frontend queries `/api/setup/status` and shows `/setup` or `/login` accordingly. Network, rate-limit, and server failures from either request remain error/retry states, not login redirects.

The setup-status endpoint is informational only. The setup-creation endpoint must independently and atomically verify that setup is still allowed so that two clients cannot both create the initial administrator after observing `setupRequired: true`. Prefer tracking explicit setup completion state if the backend has such a mechanism; otherwise, the status endpoint can derive it from whether the `users` table is empty.

The token's local expiry check is only a frontend shortcut; the backend still validates it on protected requests.
