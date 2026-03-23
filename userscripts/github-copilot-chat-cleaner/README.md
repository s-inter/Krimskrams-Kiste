# GitHub Copilot Chat Cleaner

A Tampermonkey/Greasemonkey userscript that lets you bulk-delete old GitHub Copilot chat threads directly from the browser.

## What it does

- **Auto-discovers** your Copilot API token from `localStorage` — no manual copying required. Falls back to a live token refresh if the stored token is missing or expired.
- **Fetches** all your Copilot chat threads via the Copilot API.
- **Filters** threads by age (e.g. older than 7 days) or targets every thread regardless of date.
- **Dry-run mode** — preview which threads would be deleted before committing.
- **Bulk delete** — deletes selected threads with rate limiting (150 ms between requests) to avoid hitting API limits.
- **Sidebar button** — injects a 🗑️ "Chat cleanup" button into the Copilot sidebar footer so the panel is always one click away.

## Installation

### Prerequisites

Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension (Chrome, Firefox, Edge, Safari).

### Install the script

**Option A — Install from URL (recommended)**

1. Open Tampermonkey → *Dashboard* → *Utilities* tab.
2. Paste the raw file URL into the *Install from URL* field and click *Install*:
   ```
   https://raw.githubusercontent.com/s-inter/Krimskrams-Kiste/main/userscripts/github-copilot-chat-cleaner/gh-chat-cleaner.user.js
   ```
3. Confirm the installation in the Tampermonkey dialog.

**Option B — Manual install**

1. Open Tampermonkey → *Dashboard* → click **+** to create a new script.
2. Replace all default content with the contents of [`gh-chat-cleaner.user.js`](./gh-chat-cleaner.user.js).
3. Save with **Ctrl+S** (or **Cmd+S**).

## Usage

1. Navigate to [github.com/copilot](https://github.com/copilot).
2. Click the **🗑️ Chat cleanup** button in the Copilot sidebar footer (bottom-left area), or wait for the floating panel to appear.
3. Set the **age threshold** (e.g. `7` to target threads older than 7 days), or tick **Delete all chats** to ignore the date filter.
4. Click **📋 Dry Run** to preview the threads that would be deleted.
5. Review the list, then click **🗑️ Delete** and confirm the prompt to permanently remove them.

## Notes

- Deletions are **permanent and cannot be undone**.
- The script only runs on `https://github.com/copilot*` pages.
- The API token is read from `localStorage` and never sent anywhere other than the official GitHub Copilot API.
