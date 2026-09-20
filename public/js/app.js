(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("login-view");
  var app = $("app");
  var loginForm = $("login-form");
  var loginCode = $("login-code");
  var loginError = $("login-error");
  var toastEl = $("toast");
  var state = {
    page: 1,
    timer: null,
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.add("hidden"); }, 2400);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, opts);
    if (res.status === 401) {
      showLogin();
      throw new Error("登录已过期");
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ("请求失败 " + res.status));
    return data;
  }

  // 私密区域用单独一套凭证（超级码 → log_private Cookie），
  // 所以不能走 api()：它遇到 401 会把人踢回登录页，这里弹错就好
  async function apiPrivate(path, opts) {
    var res = await fetch(path, opts);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ("请求失败 " + res.status));
    return data;
  }

  function showLogin() {
    app.classList.add("hidden");
    loginView.classList.remove("hidden");
    loginCode.focus();
  }

  function showApp() {
    loginView.classList.add("hidden");
    app.classList.remove("hidden");
    loadSources();
    loadLogs();
  }

  loginForm.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var code = loginCode.value.trim();
    if (!code) return;
    loginError.classList.add("hidden");
    var btn = loginForm.querySelector("button");
    btn.disabled = true;
    try {
      await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
      });
      loginCode.value = "";
      showApp();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });

  $("logout-btn").addEventListener("click", async function () {
    try { await api("/api/logout", { method: "POST" }); } catch (e) {}
    state.page = 1;
    showLogin();
  });

  function dayRange() {
    var now = new Date();
    var from = new Date(now.getTime() - 24 * 3600 * 1000);
    function fmt(d) {
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }
    return { from: fmt(from), to: fmt(now) };
  }

  function initDates() {
    var r = dayRange();
    if (!$("from").value) $("from").value = r.from;
    if (!$("to").value) $("to").value = r.to;
  }

  async function loadSources() {
    try {
      var data = await api("/api/v1/sources");
      var sel = $("source");
      var current = sel.value;
      sel.innerHTML = '<option value="">全部来源</option>';
      (data.sources || []).forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.source;
        o.textContent = s.source + "（" + s.count + "）";
        sel.appendChild(o);
      });
      if (current) sel.value = current;
    } catch (e) {
      toast(e.message);
    }
  }

  function params() {
    var from = $("from").value ? new Date($("from").value + "T00:00:00").getTime() : "";
    var to = $("to").value ? new Date($("to").value + "T23:59:59.999").getTime() : "";
    var p = new URLSearchParams({
      page: state.page,
      size: "100",
    });
    if ($("source").value) p.set("source", $("source").value);
    if ($("level").value) p.set("level", $("level").value);
    if ($("q").value.trim()) p.set("q", $("q").value.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }

  async function loadLogs() {
    try {
      var data = await api("/api/v1/logs?" + params().toString());
      render(data);
    } catch (e) {
      toast(e.message);
    }
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function render(data) {
    var list = $("log-list");
    list.innerHTML = "";
    $("summary").textContent = "共 " + data.total + " 条日志";
    $("page-no").textContent = "第 " + data.page + " / " + data.pages + " 页";
    $("prev").disabled = data.page <= 1;
    $("next").disabled = data.page >= data.pages;
    $("updated").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " 更新";

    if (!data.logs.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "暂无符合条件的日志";
      list.appendChild(e);
      return;
    }

    data.logs.forEach(function (row) {
      var el = document.createElement("div");
      el.className = "log-row";
      var metaHtml = row.meta ? '<div class="log-meta">meta<pre>' + esc(JSON.stringify(row.meta, null, 2)) + "</pre></div>" : "";
      el.innerHTML =
        '<span class="log-time">' + esc(fmtTime(row.ts)) + "</span>" +
        '<span class="log-source">' + esc(row.source) + "</span>" +
        '<span class="log-level ' + esc(row.level) + '">' + esc(row.level) + "</span>" +
        '<div class="log-main"><div class="log-message">' + esc(row.message) + "</div>" + metaHtml + "</div>";
      list.appendChild(el);
    });
  }

  $("query-btn").addEventListener("click", function () {
    state.page = 1;
    loadLogs();
  });
  $("reset-btn").addEventListener("click", function () {
    $("source").value = "";
    $("level").value = "";
    $("q").value = "";
    initDates();
    state.page = 1;
    loadLogs();
  });
  $("prev").addEventListener("click", function () {
    if (state.page > 1) { state.page--; loadLogs(); }
  });
  $("next").addEventListener("click", function () {
    state.page++; loadLogs();
  });
  $("source").addEventListener("change", function () { state.page = 1; loadLogs(); });
  $("level").addEventListener("change", function () { state.page = 1; loadLogs(); });
  $("q").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { state.page = 1; loadLogs(); }
  });

  $("live").addEventListener("change", function () {
    clearInterval(state.timer);
    if ($("live").checked) state.timer = setInterval(loadLogs, 5000);
  });

  initDates();

  /* ---------- 私密区域 ---------- */
  var privateView = $("private-view");

  function privateShow() {
    privateView.classList.remove("hidden");
    privateRefreshState();
  }

  function privateHide() {
    privateView.classList.add("hidden");
  }

  function privateError(msg) {
    var el = $("private-error");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  async function privateRefreshState() {
    try {
      var st = await apiPrivate("/api/private/state");
      if (!st.configured) {
        privateError("服务端没有配置私密区域访问码（/etc/super-code.env 的 SUPER_CODE）");
        $("private-lock").classList.add("hidden");
        $("private-body").classList.add("hidden");
        return;
      }
      privateError("");
      var unlocked = !!st.unlocked;
      $("private-lock").classList.toggle("hidden", unlocked);
      $("private-body").classList.toggle("hidden", !unlocked);
      if (unlocked) loadPrivateLogs();
    } catch (e) {
      privateError(e.message);
    }
  }

  async function loadPrivateLogs() {
    try {
      var data = await apiPrivate("/api/private/logs?size=100");
      renderPrivateLogs(data);
    } catch (e) {
      privateError(e.message);
    }
  }

  function renderPrivateLogs(data) {
    var list = $("private-list");
    list.innerHTML = "";
    $("private-status").textContent = "共 " + data.total + " 条 · " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " 更新";
    if (!data.logs.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有私密记录，写一条试试";
      list.appendChild(empty);
      return;
    }
    data.logs.forEach(function (row) {
      var el = document.createElement("div");
      el.className = "log-row";
      var metaHtml = row.meta ? '<div class="log-meta">meta<pre>' + esc(JSON.stringify(row.meta, null, 2)) + "</pre></div>" : "";
      el.innerHTML =
        '<span class="log-time">' + esc(fmtTime(row.ts)) + "</span>" +
        '<span class="log-source">' + esc(row.source) + "</span>" +
        '<span class="log-level ' + esc(row.level) + '">' + esc(row.level) + "</span>" +
        '<div class="log-main"><div class="log-message">' + esc(row.message) + "</div>" + metaHtml + "</div>";
      list.appendChild(el);
    });
  }

  $("private-btn").addEventListener("click", privateShow);
  $("private-btn-login").addEventListener("click", privateShow);
  $("private-close").addEventListener("click", privateHide);
  $("private-refresh").addEventListener("click", loadPrivateLogs);

  $("private-lock").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var code = $("private-code").value.trim();
    if (!code) return;
    try {
      await apiPrivate("/api/private/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
      });
      $("private-code").value = "";
      privateError("");
      privateRefreshState();
    } catch (e) {
      privateError(e.message);
    }
  });

  $("private-lock-btn").addEventListener("click", async function () {
    try { await apiPrivate("/api/private/lock", { method: "POST" }); } catch (e) {}
    $("private-list").innerHTML = "";
    privateRefreshState();
  });

  $("private-note-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var text = $("private-note").value.trim();
    if (!text) return;
    try {
      await apiPrivate("/api/private/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      $("private-note").value = "";
      loadPrivateLogs();
    } catch (e) {
      privateError(e.message);
    }
  });

  api("/api/me")
    .then(function () {
      showApp();
      state.timer = setInterval(function () {
        if ($("live").checked) loadLogs();
      }, 5000);
    })
    .catch(function () {
      showLogin();
    });
})();
