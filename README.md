> **Moved:** active development and releases are now in the private [Exoah repository](https://github.com/cristiancringasu/Exoah). This repository is retained as read-only history. Use the [current setup and operations cheatsheet](https://github.com/cristiancringasu/Exoah/blob/main/CHEATSHEET.md).

# Exotics Café issue board

[Complete project setup and operations cheatsheet](https://github.com/cristiancringasu/exoah-api/blob/main/CHEATSHEET.md) — available to the private API repository's collaborators. It covers all four projects, configuration, deployment, backups and useful commands. Credentials stay outside Git.

Use Node 24, run `npm ci`, copy `.env.example` to `.env`, then `npm run dev`. The local board runs on port 3001 and uses the API on port 33123. Set `WATCH_USE_POLLING=true` in the development process environment if filesystem watching stalls.

Guests can read the shared board and submit new reports. Existing reports, comments, status changes, imports and raw JSON edits require an actual administrator account from the Exotics Café API. There is no client-side maintainer key. Saves use a revision check to prevent overwriting someone else's work. When a conflict appears, export any unsaved work before refreshing.

`npm run build`, `npm run lint`, `npm run format:check` and `npm audit --audit-level=moderate` check the project. Deploy the `dist/` build to Vercel with `VITE_BUGS_API_BASE=https://api.exotics.cafe`; include the board's exact origin in API `CORS_ORIGINS`.

Reports are public. Do not paste passwords, private keys or sensitive account details into them. The API persists board data in `BUGS_JSON_PATH`; it belongs in the API data backup. The repository's `bugs.json` is an existing reference backlog and is not automatically published to a server.
