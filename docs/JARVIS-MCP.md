# Jarvis as a Claude connector (MCP)

Jarvis exposes a small MCP server so the Claude app (iPhone, web, desktop) can read and write your second brain and send tasks to your computers.

## Setup

1. Generate a long random token (at least 32 characters), for example in PowerShell:

   ```powershell
   -join ((48..57)+(97..122) | Get-Random -Count 48 | % {[char]$_})
   ```
2. In Netlify, add the environment variable `JARVIS_MCP_TOKEN` with that value and redeploy.
3. In Claude: Settings > Connectors > Add custom connector. Name it "Jarvis" and use the URL

   `https://abiolaonikoyi.com/api/jarvis-mcp/<token>`

   Leave any OAuth fields empty. Connectors added on one device sync to your account, so the iPhone app sees it too.
4. In a Claude chat, enable the Jarvis connector and ask, for example: "What is on my plate today?" or "On the Kuwait office PC, look at the hoppertax repo and tell me what is unfinished."

## Tools exposed

- Everything in the Jarvis chat toolset (projects, tasks, notes, decisions, documents, search, activity...). Write tools apply immediately, exactly as in Jarvis chat.
- `list_computers`, `run_on_computer`, `get_computer_job` (see docs/JARVIS-BRIDGE.md).
- `get_today`: tasks due or overdue, the latest briefing, and recent Jarvis signals still new or pushed.

Protocol: stateless JSON-RPC 2.0 over POST with `application/json` responses (`initialize`, `ping`, `tools/list`, `tools/call`; `notifications/*` return 202). GET returns 405. A wrong or unset token returns 404.

## Security trade-off

The token in the URL is the only credential. Anyone holding the URL can read and change your Jarvis data and queue tasks on your computers, with no login and no expiry. Reasons it is still acceptable here: it is a single-user app, the token is long and compared in constant time, and the custom connector UI offers no better way to attach a header.

Reduce the risk:

- Treat the URL like a password: do not paste it in chats, screenshots or shared notes.
- Use a 48+ character random token. Rotate it by changing `JARVIS_MCP_TOKEN` in Netlify and re-adding the connector (the old URL stops working at once).
- Computers run tasks in "Look only" mode unless a request explicitly asks for edit mode; review `run_on_computer` calls Claude proposes before approving them.
- URLs can appear in Netlify function logs and Claude's connector settings; remove the connector if you stop using it.
