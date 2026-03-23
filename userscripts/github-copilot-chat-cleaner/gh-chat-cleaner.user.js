// ==UserScript==
// @name         GitHub Copilot Chat Cleaner
// @namespace    https://github.com/copilot
// @version      1.0
// @description  Delete old GitHub Copilot chat sessions by age - auto-discovers token from localStorage
// @author       You
// @match        https://github.com/copilot*
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://api.business.githubcopilot.com/github/chat/threads";
  const TOKEN_REFRESH_URL = "https://github.com/github-copilot/chat/token";
  const DEFAULT_DAYS = 7;
  const DELAY_MS = 150; // Rate limiting delay between deletes

  // State management
  let currentToken = null;

  // Discover and retrieve token from localStorage
  function getStorageToken() {
    const rawToken = localStorage.getItem("COPILOT_AUTH_TOKEN");
    const expiry = localStorage.getItem("COPILOT_AUTH_TOKEN:expiry");

    if (!rawToken) {
      console.log("[COPILOT-CLEANER] ❌ No token found in localStorage");
      return null;
    }

    let token = rawToken;
    // Some builds store a JSON object like {"value":"..."}
    if (rawToken.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(rawToken);
        if (parsed && typeof parsed.value === "string") {
          token = parsed.value;
        }
      } catch (error) {
        console.warn("[COPILOT-CLEANER] ⚠️ Failed to parse token JSON, using raw value");
      }
    }

    console.log("[COPILOT-CLEANER] ✅ Token discovered in localStorage");

    // Check expiry if available
    if (expiry) {
      let expiryDate;
      
      // Handle both ISO 8601 format and Unix timestamp (milliseconds)
      if (/^\d+$/.test(expiry)) {
        // Unix timestamp in milliseconds
        expiryDate = new Date(parseInt(expiry, 10));
      } else {
        // ISO 8601 format
        expiryDate = new Date(expiry);
      }
      
      if (isNaN(expiryDate.getTime())) {
        console.log("[COPILOT-CLEANER] ⚠️ Could not parse expiry date, will refresh on next use");
        return token;
      }
      
      const now = new Date();
      if (now > expiryDate) {
        console.log("[COPILOT-CLEANER] ⚠️ Token is expired, will refresh on next use");
        return token; // Return anyway, let permissive flow handle refresh
      } else {
        console.log("[COPILOT-CLEANER] ✅ Token is valid, expires at:", expiryDate.toISOString());
      }
    }

    return token;
  }

  // Refresh token via GitHub's token endpoint
  async function refreshToken() {
    console.log("[COPILOT-CLEANER] 🔄 Attempting to refresh token...");

    try {
      const response = await fetch(TOKEN_REFRESH_URL, {
        method: "POST",
        headers: {
          "x-requested-with": "XMLHttpRequest",
          "x-github-client-version": "github-copilot/1.0", // Placeholder version
          "github-verified-fetch": "true",
        },
      });

      if (!response.ok) {
        console.error("[COPILOT-CLEANER] ❌ Token refresh failed, HTTP:", response.status);
        return false;
      }

      const data = await response.json();

      if (data.token) {
        currentToken = data.token;
        console.log("[COPILOT-CLEANER] ✅ Token refreshed successfully (stored in memory only)");
        return true;
      }

      console.error("[COPILOT-CLEANER] ❌ No token in refresh response");
      return false;
    } catch (error) {
      console.error("[COPILOT-CLEANER] ❌ Token refresh error:", error);
      return false;
    }
  }

  // Get token with fallback to refresh on first use
  async function ensureToken() {
    if (!currentToken) {
      currentToken = getStorageToken();
    }

    if (!currentToken) {
      console.log("[COPILOT-CLEANER] 🔄 Token not available, attempting refresh...");
      const refreshed = await refreshToken();
      if (!refreshed) {
        throw new Error("Unable to obtain authorization token");
      }
      // currentToken is now set by refreshToken()
    }

    return currentToken;
  }

  // UI Container
  function createUI() {
    const container = document.createElement("div");
    container.id = "copilot-chat-cleaner";
    container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 350px;
            background: #fff;
            border: 1px solid #d0d7de;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 8px 24px rgba(149,157,165,.2);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            z-index: 10000;
            display: none;
        `;

    container.innerHTML = `
            <div style="margin-bottom: 12px;">
                <strong style="display: block; margin-bottom: 8px; font-size: 14px;">Copilot Chat Cleanup</strong>
            </div>
            
            <form style="margin-bottom: 12px;">
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 13px; margin-bottom: 4px;">Delete chats older than (days):</label>
                    <input type="number" id="days-input" min="0" value="${DEFAULT_DAYS}" style="width: 100%; padding: 6px; border: 1px solid #d0d7de; border-radius: 4px; box-sizing: border-box; font-size: 13px; transition: opacity 0.2s, background-color 0.2s;">
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="display: flex; align-items: center; font-size: 13px; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="delete-all-toggle" style="cursor: pointer;">
                        <span>Delete all chats (ignore date)</span>
                    </label>
                </div>
            </form>
            
            <div id="status" style="margin-bottom: 12px; padding: 8px; background: #f6f8fa; border-radius: 4px; font-size: 12px; min-height: 20px; display: none;"></div>
            
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button id="dry-run-btn" style="flex: 1; padding: 8px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">📋 Dry Run</button>
                <button id="delete-btn" style="flex: 1; padding: 8px; background: #da3633; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;" disabled>🗑️ Delete</button>
            </div>
            <button id="close-btn" style="width: 100%; padding: 8px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 4px; cursor: pointer; font-size: 13px;">✕ Close</button>
        `;

    return container;
  }

  function updateStatus(message, type = "info") {
    const statusEl = document.getElementById("status");
    statusEl.textContent = message;
    statusEl.style.display = "block";
    statusEl.style.background =
      type === "error" ? "#ffeef0" : type === "success" ? "#dafbe1" : "#f6f8fa";
    statusEl.style.color =
      type === "error" ? "#d1242f" : type === "success" ? "#033a16" : "#24292f";
  }

  async function fetchThreads() {
    const token = await ensureToken();

    if (!token) {
      updateStatus("❌ Authorization token could not be obtained", "error");
      throw new Error("Missing authorization token");
    }

    console.log("[COPILOT-CLEANER] Using token:", token.substring(0, 20) + "...");

    try {
      const response = await fetch(API_BASE, {
        headers: {
          "Authorization": `GitHub-Bearer ${token}`,
          "Content-Type": "application/json",
          "copilot-integration-id": "copilot-chat",
          "x-github-api-version": "2025-05-01",
        },
      });

      console.log("[COPILOT-CLEANER] API response status:", response.status);

      // Permissive flow: if 401, try to refresh token and retry
      if (response.status === 401 || response.status === 403) {
        console.log("[COPILOT-CLEANER] ⚠️ Auth failed (HTTP", response.status + "), attempting token refresh...");
        const refreshed = await refreshToken();
        if (refreshed) {
          // currentToken is now set by refreshToken()
          const retryResponse = await fetch(API_BASE, {
            headers: {
              "Authorization": `GitHub-Bearer ${currentToken}`,
              "Content-Type": "application/json",
              "copilot-integration-id": "copilot-chat",
              "x-github-api-version": "2025-05-01",
            },
          });
          if (!retryResponse.ok) throw new Error(`HTTP ${retryResponse.status} (retry)`);
          const data = await retryResponse.json();
          return data.threads || [];
        } else {
          throw new Error("Token refresh failed");
        }
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("[COPILOT-CLEANER] Error response body:", errorBody);
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }
      const data = await response.json();
      return data.threads || [];
    } catch (error) {
      console.error("Failed to fetch threads:", error);
      updateStatus(`❌ Failed to fetch: ${error.message}`, "error");
      throw error;
    }
  }

  function filterOldThreads(threads, daysOld, deleteAll = false) {
    if (deleteAll) {
      return threads; // Return all threads
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return threads.filter((thread) => {
      const createdDate = new Date(thread.createdAt);
      return createdDate < cutoffDate;
    });
  }

  async function doDryRun() {
    const daysInput = document.getElementById("days-input");
    const deleteAllToggle = document.getElementById("delete-all-toggle");
    const days = parseInt(daysInput.value, 10);
    const deleteAll = deleteAllToggle.checked;

    if (isNaN(days) || (days < 1 && !deleteAll)) {
      const msg = deleteAll 
        ? "❌ Please enter a valid number in days (or toggle 'Delete all' OFF)" 
        : "❌ Days must be 1 or more (or enable 'Delete all chats' for no date filtering)";
      updateStatus(msg, "error");
      return;
    }

    updateStatus("📊 Fetching threads...", "info");

    try {
      const threads = await fetchThreads();
      const oldThreads = filterOldThreads(threads, days, deleteAll);

      if (oldThreads.length === 0) {
        const msg = deleteAll ? "✅ No chats found" : `✅ No chats older than ${days} day(s)`;
        updateStatus(msg, "success");
      } else {
        const summary = oldThreads.map((t) => `• ${t.name}`).join("\n");
        const prefix = deleteAll ? `${oldThreads.length} chat(s) (all)` : `${oldThreads.length} chat(s) older than ${days} day(s)`;
        updateStatus(
          `📋 Found ${prefix}\n\nWould delete:\n${summary.substring(0, 150)}${summary.length > 150 ? "..." : ""}`,
          "info",
        );
      }

      // Store for later bulk delete
      window.copilotThreadsToDelete = oldThreads;
      document.getElementById("delete-btn").disabled = oldThreads.length === 0;
    } catch (error) {
      console.error("Dry run failed:", error);
    }
  }

  async function doDelete() {
    const oldThreads = window.copilotThreadsToDelete || [];
    const token = await ensureToken();
    const deleteAllToggle = document.getElementById("delete-all-toggle");
    const deleteAll = deleteAllToggle.checked;

    if (!token) {
      updateStatus("❌ Authorization token could not be obtained", "error");
      return;
    }

    if (oldThreads.length === 0) {
      updateStatus("❌ No threads selected for deletion", "error");
      return;
    }

    const daysInput = document.getElementById("days-input");
    const days = parseInt(daysInput.value, 10);

    // Confirmation dialog
    const msg = deleteAll 
      ? `Delete ALL ${oldThreads.length} chat(s)?\n\nThis CANNOT be undone.`
      : `Delete ${oldThreads.length} chat(s) older than ${days} day(s)?\n\nThis CANNOT be undone.`;
    const confirmed = confirm(msg);

    if (!confirmed) {
      updateStatus("⏸️ Deletion cancelled", "info");
      return;
    }

    updateStatus(`🗑️ Deleting... (0/${oldThreads.length})`, "info");

    let deleted = 0;
    let failed = 0;

    for (const thread of oldThreads) {
      try {
        const response = await fetch(`${API_BASE}/${thread.id}`, {
          method: "DELETE",
          headers: {
            "Authorization": `GitHub-Bearer ${token}`,
            "Content-Type": "application/json",
            "copilot-integration-id": "copilot-chat",
            "x-github-api-version": "2025-05-01",
          },
        });

        if (response.ok) {
          deleted++;
        } else {
          failed++;
          console.warn(
            `Failed to delete ${thread.id}: HTTP ${response.status}`,
          );
        }

        updateStatus(
          `🗑️ Deleting... (${deleted + failed}/${oldThreads.length})`,
          "info",
        );

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        failed++;
        console.error(`Error deleting ${thread.id}:`, error);
      }
    }

    const message =
      failed === 0
        ? `✅ Successfully deleted ${deleted} chat(s)!`
        : `⚠️ Deleted ${deleted}, failed ${failed}`;

    updateStatus(message, failed === 0 ? "success" : "error");
    window.copilotThreadsToDelete = [];
    document.getElementById("delete-btn").disabled = true;
  }

  // Inject sidebar button to open/close cleaner UI
  function injectSidebarButton() {
    // Look for the footer container in the Copilot sidebar
    const footerContainer = document.querySelector('.CopilotNavigation-module__footer__vBThp') ||
                            document.querySelector('[class*="footer"]');
    
    if (!footerContainer) {
      console.warn("[COPILOT-CLEANER] ⚠️ Could not find footer container for sidebar button, retrying...");
      setTimeout(() => injectSidebarButton(), 1000);
      return false;
    }

    // Don't inject twice
    if (document.getElementById("copilot-cleaner-sidebar-btn")) {
      return true;
    }

    // Create the button matching the footer style
    const button = document.createElement("button");
    button.id = "copilot-cleaner-sidebar-btn";
    button.className = "CopilotNavigation-module__footerButton__F6OSb";
    button.setAttribute("aria-label", "Chat cleanup");
    button.innerHTML = `<svg aria-hidden="true" focusable="false" class="octicon octicon-trash CopilotNavigation-module__toggleButtonIcon__Poyzh" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="display:inline-block;overflow:visible;vertical-align:text-bottom;"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"></path></svg><span class="CopilotNavigation-module__footerButtonContent__b4D9f">Chat cleanup</span>`;

    button.addEventListener("click", (e) => {
      e.preventDefault();
      const ui = document.getElementById("copilot-chat-cleaner");
      if (ui) {
        ui.style.display = ui.style.display === "none" ? "block" : "none";
      }
    });

    // Insert button at the beginning of the footer (before Collapse button)
    footerContainer.insertAdjacentElement("afterbegin", button);
    console.log("[COPILOT-CLEANER] ✅ Sidebar button injected into footer");
    return true;
  }

  // Initialize
  function init() {
    console.log("[COPILOT-CLEANER] 🚀 Script initialized, creating UI");
    
    // Try to load token early
    currentToken = getStorageToken();

    const ui = createUI();
    document.body.appendChild(ui);
    console.log("[COPILOT-CLEANER] UI created and appended to page (hidden by default)");

    // Inject sidebar button
    setTimeout(() => injectSidebarButton(), 500);

    // Handle grey-out of days input when delete-all is toggled
    const deleteAllToggle = document.getElementById("delete-all-toggle");
    const daysInput = document.getElementById("days-input");
    
    deleteAllToggle.addEventListener("change", () => {
      if (deleteAllToggle.checked) {
        daysInput.disabled = true;
        daysInput.style.opacity = "0.5";
        daysInput.style.backgroundColor = "#f6f8fa";
        daysInput.style.cursor = "not-allowed";
      } else {
        daysInput.disabled = false;
        daysInput.style.opacity = "1";
        daysInput.style.backgroundColor = "#fff";
        daysInput.style.cursor = "text";
      }
    });

    document.getElementById("dry-run-btn").addEventListener("click", doDryRun);
    document.getElementById("delete-btn").addEventListener("click", doDelete);
    document.getElementById("close-btn").addEventListener("click", () => {
      ui.style.display = "none";
    });

    window.copilotThreadsToDelete = [];
  }

  // Initialize at document-start
  console.log("[COPILOT-CLEANER] Starting at document-start (v2)");

  // Wait for DOM ready to create UI
  if (document.readyState === "loading") {
    console.log("[COPILOT-CLEANER] DOM still loading, waiting for DOMContentLoaded");
    document.addEventListener("DOMContentLoaded", init);
  } else {
    console.log("[COPILOT-CLEANER] DOM already loaded, running init immediately");
    init();
  }
})();
