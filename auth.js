"use strict";

(() => {
  const accountPage = location.pathname === "/auth.html";
  const api = async (path, body, method = "POST") => {
    const response = await fetch("/api/account" + path, {
      method: body === undefined ? "GET" : method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000)
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("The account service did not return a valid response. Keep the CRM server running and try again."); }
    if (!response.ok || !result.success) throw new Error(result.message || "The account action could not be completed.");
    return result.data;
  };
  const domReady = new Promise(resolve => {
    if (document.readyState !== "loading") resolve();
    else document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
  const safeReturn = () => {
    const value = new URLSearchParams(location.search).get("return") || "/";
    try {
      const parsed = new URL(value, location.origin);
      return parsed.origin === location.origin && !parsed.pathname.startsWith("/auth") ? parsed.pathname + parsed.search + parsed.hash : "/";
    } catch { return "/"; }
  };
  const signIn = () => {
    const target = location.pathname + location.search + location.hash;
    location.assign("/auth.html?return=" + encodeURIComponent(target));
  };
  const account = { enabled: true, authenticated: false, canWrite: false, user: null, signIn, manage: () => location.assign("/auth.html") };
  window.CRMAuth = account;
  account.logout = async () => {
    await api("/logout", {});
    location.assign("/auth.html");
  };

  const message = (text, error = false) => {
    const box = document.getElementById("account-message");
    if (!box) return;
    box.textContent = text;
    box.classList.toggle("error", error);
    box.hidden = !text;
  };
  const withForm = (form, action) => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      if (button.disabled) return;
      button.disabled = true;
      message("");
      try { await action(); }
      catch (error) { message(error.message || "The action could not be completed.", true); }
      finally { button.disabled = false; }
    });
  };
  const element = (tag, text, properties = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.assign(node, properties);
    return node;
  };

  function showToolbar() {
    const controls = document.getElementById("account-controls");
    if (!controls || !account.enabled || !account.authenticated) return;
    controls.replaceChildren();
    controls.append(element("span", account.user.username + " · " + account.user.role, { className: "account-role" }));
    controls.append(element("a", account.user.role === "admin" ? "Manage access" : "My account", { href: "/auth.html" }));
    const logout = element("button", "Sign out", { type: "button" });
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      try { await account.logout(); }
      catch (error) { logout.disabled = false; logout.textContent = "Retry sign out"; logout.title = error.message; }
    });
    controls.append(logout);
  }

  async function loadUsers() {
    const users = await api("/users");
    const list = document.getElementById("account-users");
    list.replaceChildren();
    for (const user of users) {
      const card = element("div", undefined, { className: "account-user" });
      card.append(element("h3", user.username + (user.id === account.user.id ? " (you)" : "")));
      const form = element("form");
      const roleLabel = element("label", "Role", { htmlFor: "role-" + user.id });
      const role = element("select", undefined, { id: "role-" + user.id });
      for (const [value, label] of [["viewer", "Viewer — read only"], ["editor", "Editor — manage CRM records"], ["admin", "Administrator — records and accounts"]]) {
        role.append(element("option", label, { value, selected: value === user.role }));
      }
      const activeLabel = element("label", undefined, { className: "account-checkbox" });
      const active = element("input", undefined, { type: "checkbox", checked: user.active });
      activeLabel.append(active, document.createTextNode("Account is active"));
      form.append(roleLabel, role, activeLabel, element("button", "Save access", { type: "submit" }));
      withForm(form, async () => {
        await api("/users/" + user.id, { role: role.value, active: active.checked }, "PATCH");
        if (user.id === account.user.id) return location.assign("/auth.html");
        message("Access updated for " + user.username + ". Their previous sessions have been signed out.");
        await loadUsers();
      });
      card.append(form);
      if (user.id !== account.user.id) {
        const details = element("details", undefined, { className: "account-reset" });
        details.append(element("summary", "Reset this account's password"));
        const resetForm = element("form");
        const label = element("label", "New password", { htmlFor: "reset-" + user.id });
        const password = element("input", undefined, { id: "reset-" + user.id, type: "password", autocomplete: "new-password", minLength: 12, maxLength: 128, required: true });
        resetForm.append(label, password, element("button", "Reset password", { type: "submit" }));
        withForm(resetForm, async () => {
          await api("/users/" + user.id + "/password", { password: password.value });
          resetForm.reset();
          details.open = false;
          message("Password reset for " + user.username + ". Share the new password privately; previous sessions are signed out.");
        });
        details.append(resetForm);
        card.append(details);
      }
      list.append(card);
    }
  }

  async function showAccountPage(status) {
    if (!status.enabled) {
      document.getElementById("account-title").textContent = "Local access is not enabled in this test server.";
      document.getElementById("account-intro").textContent = "Use the normal CRM launcher for the signed-in workspace.";
      return;
    }
    if (!status.authenticated) {
      const setup = status.needsSetup;
      document.getElementById("account-title").textContent = setup ? "Make this workspace yours." : "Welcome back.";
      document.getElementById("account-intro").textContent = setup ? "Create the first administrator account on this computer. No default password has been created." : "Sign in with a local account to open the CRM.";
      document.getElementById("entry-heading").textContent = setup ? "Set up your administrator account" : "Sign in";
      document.getElementById("entry-submit").textContent = setup ? "Create administrator and open CRM" : "Sign in";
      document.getElementById("setup-password-help").hidden = !setup;
      document.getElementById("entry-password").autocomplete = setup ? "new-password" : "current-password";
      document.getElementById("entry-password").minLength = setup ? 12 : 1;
      document.getElementById("account-entry").hidden = false;
      withForm(document.getElementById("account-entry-form"), async () => {
        await api(setup ? "/setup" : "/login", { username: document.getElementById("entry-username").value, password: document.getElementById("entry-password").value });
        location.assign(safeReturn());
      });
      return;
    }
    document.getElementById("account-title").textContent = "Your account and workspace access.";
    document.getElementById("account-intro").textContent = "Manage your password" + (status.user.role === "admin" ? " and the people who can use this local CRM." : ".");
    document.getElementById("account-signed-in").hidden = false;
    document.getElementById("account-identity").textContent = "Signed in as " + status.user.username + " · " + status.user.role;
    document.getElementById("account-back").href = safeReturn();
    document.getElementById("account-logout").addEventListener("click", () => account.logout().catch(error => message(error.message, true)));
    withForm(document.getElementById("account-password-form"), async () => {
      await api("/password", { currentPassword: document.getElementById("current-password").value, newPassword: document.getElementById("new-password").value });
      document.getElementById("account-password-form").reset();
      message("Password changed. Your other sessions have been signed out.");
    });
    if (status.user.role === "admin") {
      document.getElementById("account-admin").hidden = false;
      withForm(document.getElementById("account-add-form"), async () => {
        const username = document.getElementById("add-username").value;
        await api("/users", { username, password: document.getElementById("add-password").value, role: document.getElementById("add-role").value });
        document.getElementById("account-add-form").reset();
        message("Account created for " + username + ". Share the initial password privately.");
        await loadUsers();
      });
      await loadUsers();
    }
  }

  account.ready = (async () => {
    try {
      const status = await api("/status");
      Object.assign(account, status);
      await domReady;
      if (accountPage) await showAccountPage(status);
      else if (status.enabled && !status.authenticated) signIn();
      else showToolbar();
      document.dispatchEvent(new CustomEvent("crm:access", { detail: status }));
      return status;
    } catch (error) {
      const status = { enabled: true, authenticated: false, user: null, canWrite: false, error: error.message };
      Object.assign(account, status);
      await domReady;
      if (accountPage) message(error.message, true);
      else {
        const controls = document.getElementById("account-controls");
        if (controls) controls.append(element("a", "Sign-in service unavailable — retry", { href: "/auth.html" }));
      }
      return status;
    }
  })();
})();
