// Owner's schedule editor. Talks to /api/login, /api/session, /api/schedule.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("login-view");
  var editorView = $("editor-view");
  var loading = $("loading");
  var logoutBtn = $("logout");
  var daysEl = $("days");
  var saveBtn = $("save");
  var saveMsg = $("save-msg");
  var dirty = false;

  // Class names the owner can pick from (they can also type a new one).
  var KNOWN_NAMES = [
    "Intro to Pole", "Pole Level 1 & 2", "Pole Level 3 & 4",
    "Intro to Spin", "Spin Pole 1 & 2", "Spin Pole 3 & 4",
    "Intro to Exotic", "Heel Flow", "Polesque", "Chair & Floor",
    "Belly Dance", "Acro-Stretch"
  ];

  fetch("/api/session", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (s) { s.loggedIn ? showEditor() : showLogin(); })
    .catch(function () {
      loading.textContent = "The edit page only works on the live site (it needs the server).";
    });

  // ---------- login ----------
  function showLogin() {
    loading.hidden = true;
    editorView.hidden = true;
    logoutBtn.hidden = true;
    loginView.hidden = false;
    $("password").focus();
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("login-msg");
    msg.textContent = "";
    var btn = e.target.querySelector("button");
    btn.disabled = true;
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body.error || "Couldn't log in.");
        $("password").value = "";
        showEditor();
      })
      .catch(function (err) { msg.textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });

  logoutBtn.addEventListener("click", function () {
    if (dirty && !confirm("You have unsaved changes. Log out anyway?")) return;
    fetch("/api/logout", { method: "POST" }).then(function () {
      dirty = false;
      showLogin();
    });
  });

  // ---------- editor ----------
  var CLASS_MINUTES = 60;          // used to spot classes that overlap
  var OTHER = "__other";
  var daybar = $("daybar");
  var conflictsEl = $("conflicts");
  var undoBtn = $("undo");
  var settings = $("settings");
  var activeDay = null;
  var knownNames = [];
  var undoState = null;
  var undoTimer = null;

  function showEditor() {
    loginView.hidden = true;
    if (dirty) {
      // logged back in after the session ran out: keep the unsaved edits
      editorView.hidden = false;
      logoutBtn.hidden = false;
      setMsg("Logged back in. Press Save & publish to save your changes.", "warn");
      return;
    }
    loading.hidden = false;
    S.loadSchedule().then(function (data) {
      fillEditor(data);
      loading.hidden = true;
      editorView.hidden = false;
      logoutBtn.hidden = false;
    });
  }

  // "06:00" ... "22:00" every 15 minutes
  var TIME_OPTIONS = [];
  for (var m = 6 * 60; m <= 22 * 60; m += 15) {
    TIME_OPTIONS.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  }
  function minutes(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }

  function fillEditor(data) {
    $("month").value = data.month || "";
    $("note").value = data.note || "";
    var prices = S.pricesOf(data);
    $("price-twice").value = prices.twice;
    $("price-once").value = prices.once;
    $("price-registration").value = prices.registration;
    settings.open = window.matchMedia("(min-width: 1000px)").matches;

    var names = KNOWN_NAMES.slice();
    (data.classes || []).forEach(function (c) { if (names.indexOf(c.name) === -1) names.push(c.name); });
    knownNames = names;

    daysEl.textContent = "";
    daybar.textContent = "";
    S.DAYS.forEach(function (d) {
      var rows = el("div", { class: "admin-rows" });
      var addBtn = el("button", { type: "button", class: "add-class", text: "+ Add a class on " + d.long });
      addBtn.addEventListener("click", function () {
        var row = makeRow({ time: "", name: "" });
        rows.appendChild(row);
        row.querySelector(".f-name").focus();
        markDirty();
      });
      var count = el("span", { class: "day-count" });
      var panel = el("section", { class: "admin-card admin-day", "data-day": d.key }, [
        el("h3", null, [el("span", { text: d.long }), count]), rows, addBtn
      ]);
      S.sortClasses((data.classes || []).filter(function (c) { return c.day === d.key; }))
        .forEach(function (c) { rows.appendChild(makeRow(c)); });
      daysEl.appendChild(panel);

      var tab = el("button", { type: "button", role: "tab", class: "daybar-tab", "data-day": d.key }, [
        el("span", { class: "daybar-name", text: d.short }),
        el("span", { class: "daybar-count" })
      ]);
      tab.addEventListener("click", function () { showDay(d.key); });
      daybar.appendChild(tab);
    });

    // open on today, or the next day that has classes
    if (!activeDay) {
      var order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      var t = order.indexOf(S.todayKey());
      activeDay = S.todayKey();
      for (var i = 0; i < 7; i++) {
        var k = order[(t + i) % 7];
        if ((data.classes || []).some(function (c) { return c.day === k; })) { activeDay = k; break; }
      }
    }
    showDay(activeDay);
    dirty = false;
    refresh();
    setMsg("All changes saved.", "");
  }

  function showDay(key) {
    activeDay = key;
    daybar.querySelectorAll(".daybar-tab").forEach(function (t) {
      t.setAttribute("aria-selected", String(t.getAttribute("data-day") === key));
    });
    daysEl.querySelectorAll(".admin-day").forEach(function (p) {
      p.classList.toggle("is-active", p.getAttribute("data-day") === key);
    });
  }

  function nameOptions(select, current) {
    select.textContent = "";
    select.appendChild(el("option", { value: "", text: "Choose a class…" }));
    knownNames.forEach(function (n) { select.appendChild(el("option", { value: n, text: n })); });
    select.appendChild(el("option", { value: OTHER, text: "Other (type a name)…" }));
    select.value = current && knownNames.indexOf(current) !== -1 ? current : (current ? OTHER : "");
  }

  function makeRow(c) {
    var time = el("select", { class: "f-time", "aria-label": "Start time" });
    time.appendChild(el("option", { value: "", text: "Time" }));
    var times = TIME_OPTIONS.slice();
    if (c.time && times.indexOf(c.time) === -1) { times.push(c.time); times.sort(); }
    times.forEach(function (t) { time.appendChild(el("option", { value: t, text: S.formatTime(t) })); });
    time.value = c.time || "";

    var name = el("select", { class: "f-name", "aria-label": "Class" });
    nameOptions(name, c.name);
    var custom = el("input", { type: "text", class: "f-custom", maxlength: "60", placeholder: "New class name", "aria-label": "New class name" });
    custom.hidden = name.value !== OTHER;
    if (name.value === OTHER) custom.value = c.name || "";

    var remove = el("button", { type: "button", class: "remove", "aria-label": "Remove this class" });
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    var warn = el("p", { class: "row-warn", hidden: "" });

    var row = el("div", { class: "admin-row", "data-cat": S.categoryOf(c.name) }, [
      time, el("div", { class: "name-cell" }, [name, custom]), remove, warn
    ]);

    name.addEventListener("change", function () {
      custom.hidden = name.value !== OTHER;
      if (!custom.hidden) custom.focus();
      row.setAttribute("data-cat", S.categoryOf(rowName(row)));
    });
    custom.addEventListener("input", function () { row.setAttribute("data-cat", S.categoryOf(custom.value)); });
    time.addEventListener("change", function () { sortRows(row.parentNode); });
    remove.addEventListener("click", function () { removeRow(row); });
    return row;
  }

  function rowName(row) {
    var sel = row.querySelector(".f-name");
    return sel.value === OTHER ? row.querySelector(".f-custom").value.trim() : sel.value;
  }

  function sortRows(rows) {
    if (!rows) return;
    Array.from(rows.children)
      .sort(function (a, b) {
        var ta = a.querySelector(".f-time").value || "99", tb = b.querySelector(".f-time").value || "99";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      })
      .forEach(function (r) { rows.appendChild(r); });
  }

  // Delete with a short "Undo" window in case of a mis-tap.
  function removeRow(row) {
    undoState = { row: row, parent: row.parentNode, next: row.nextSibling };
    row.remove();
    markDirty();
    setMsg("Class removed.", "warn");
    undoBtn.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoBtn.hidden = true; undoState = null; }, 8000);
  }
  undoBtn.addEventListener("click", function () {
    if (!undoState) return;
    undoState.parent.insertBefore(undoState.row, undoState.next);
    undoState = null;
    undoBtn.hidden = true;
    markDirty();
  });

  // Counts, settings summary, and overlap warnings. Runs after every change.
  function refresh() {
    var conflicts = [];
    daysEl.querySelectorAll(".admin-day").forEach(function (panel) {
      var day = panel.getAttribute("data-day");
      var rows = Array.from(panel.querySelectorAll(".admin-row"));
      rows.forEach(function (r) {
        r.classList.remove("has-conflict");
        var w = r.querySelector(".row-warn"); w.hidden = true; w.textContent = "";
      });
      var filled = rows.filter(function (r) { return r.querySelector(".f-time").value && rowName(r); });
      for (var i = 0; i < filled.length; i++) {
        for (var j = i + 1; j < filled.length; j++) {
          var a = filled[i], b = filled[j];
          var ta = a.querySelector(".f-time").value, tb = b.querySelector(".f-time").value;
          if (Math.abs(minutes(ta) - minutes(tb)) >= CLASS_MINUTES) continue;
          var same = rowName(a) === rowName(b) && ta === tb;
          [[a, b, tb], [b, a, ta]].forEach(function (x) {
            x[0].classList.add("has-conflict");
            var w = x[0].querySelector(".row-warn");
            w.hidden = false;
            w.textContent = same ? "This class is listed twice at the same time." :
              (w.textContent ? w.textContent + " " : "") + "Overlaps " + rowName(x[1]) + " (" + S.formatTime(x[2]) + ").";
          });
          conflicts.push({ day: day, text: S.DAYS.filter(function (d) { return d.key === day; })[0].short + ": " +
            rowName(a) + " " + S.formatTime(ta) + (same ? " is listed twice" : " overlaps " + rowName(b) + " " + S.formatTime(tb)) });
        }
      }
      var n = rows.length;
      panel.querySelector(".day-count").textContent = n ? n + (n === 1 ? " class" : " classes") : "";
      var tab = daybar.querySelector('[data-day="' + day + '"]');
      tab.querySelector(".daybar-count").textContent = n || "–";
      tab.classList.toggle("has-conflict", panel.querySelector(".has-conflict") !== null);
    });

    conflictsEl.textContent = "";
    conflictsEl.hidden = !conflicts.length;
    if (conflicts.length) {
      conflictsEl.appendChild(el("strong", { text: conflicts.length === 1 ? "1 time conflict" : conflicts.length + " time conflicts" }));
      var ul = el("ul");
      conflicts.forEach(function (c) {
        var b = el("button", { type: "button", text: c.text });
        b.addEventListener("click", function () { showDay(c.day); });
        ul.appendChild(el("li", null, [b]));
      });
      conflictsEl.appendChild(ul);
    }

    var p = { twice: $("price-twice").value, once: $("price-once").value, reg: $("price-registration").value };
    $("settings-summary").textContent = ($("month").value || "No title") + " · $" + p.twice + " / $" + p.once + " / $" + p.reg;
    return conflicts;
  }

  editorView.addEventListener("input", markDirty);
  editorView.addEventListener("change", markDirty);

  function markDirty() {
    dirty = true;
    setMsg("You have unsaved changes.", "warn");
    refresh();
  }

  function setMsg(text, kind) {
    saveMsg.textContent = text;
    saveMsg.className = kind || "";
  }

  // Show a problem field: switch to its day (phones) or open the settings.
  function reveal(node) {
    var panel = node.closest(".admin-day");
    if (panel) showDay(panel.getAttribute("data-day"));
    if (node.closest("#settings")) settings.open = true;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function collect() {
    var classes = [];
    var problem = null;
    daysEl.querySelectorAll(".admin-day").forEach(function (panel) {
      var day = panel.getAttribute("data-day");
      panel.querySelectorAll(".admin-row").forEach(function (row) {
        var time = row.querySelector(".f-time").value;
        var name = rowName(row);
        row.classList.remove("has-error");
        if (!name && !time) return; // empty row, skip
        if (!name || !time) {
          row.classList.add("has-error");
          problem = problem || row;
          return;
        }
        classes.push({ day: day, time: time, name: name });
      });
    });
    var prices = {};
    ["twice", "once", "registration"].forEach(function (k) {
      var input = $("price-" + k);
      var v = input.value.trim();
      input.classList.remove("has-error");
      if (v === "") return;
      if (!/^\d{1,4}$/.test(v)) { input.classList.add("has-error"); problem = problem || input; return; }
      prices[k] = Number(v);
    });
    return { problem: problem, data: { month: $("month").value, note: $("note").value, prices: prices, classes: classes } };
  }

  saveBtn.addEventListener("click", function () {
    var result = collect();
    if (result.problem) {
      setMsg("Each class needs a time and a class name, and prices must be whole dollars.", "error");
      reveal(result.problem);
      return;
    }
    var conflicts = refresh();
    if (conflicts.length && !confirm("Some classes overlap:\n\n" +
        conflicts.map(function (c) { return "• " + c.text; }).join("\n") + "\n\nSave anyway?")) {
      return;
    }
    undoBtn.hidden = true;
    saveBtn.disabled = true;
    setMsg("Saving…", "");
    fetch("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.data)
    })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.status === 401) { showLogin(); throw new Error(res.body.error); }
        if (!res.ok) throw new Error(res.body.error || "Couldn't save.");
        fillEditor(res.body);
        setMsg("Saved! The website is updated.", "ok");
      })
      .catch(function (err) { setMsg(err.message || "Couldn't save. Check your connection.", "error"); })
      .then(function () { saveBtn.disabled = false; });
  });

  // ---------- social media image ----------
  var flyerMsg = $("flyer-msg");
  var flyerResult = $("flyer-result");
  var flyerImg = $("flyer-img");
  var flyerShare = $("flyer-share");
  var flyerDownload = $("flyer-download");
  var flyerBlob = null;
  var flyerUrl = null;

  document.querySelectorAll("[data-flyer]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var result = collect();
      if (result.problem) {
        flyerMsg.textContent = "Fix the highlighted class first (it needs a time and a class name).";
        reveal(result.problem);
        return;
      }
      var format = btn.getAttribute("data-flyer");
      flyerMsg.textContent = "Making your image…";
      window.SPSFlyer.render(result.data, format).then(function (canvas) {
        canvas.toBlob(function (blob) {
          flyerBlob = blob;
          if (flyerUrl) URL.revokeObjectURL(flyerUrl);
          flyerUrl = URL.createObjectURL(blob);
          var name = "sams-studio-" + (result.data.month || "schedule").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + format + ".png";
          flyerImg.src = flyerUrl;
          flyerImg.className = format;
          flyerDownload.href = flyerUrl;
          flyerDownload.setAttribute("download", name);
          flyerDownload.dataset.name = name;
          var file = new File([blob], name, { type: "image/png" });
          flyerShare.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
          flyerResult.hidden = false;
          flyerMsg.textContent = "";
          flyerResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, "image/png");
      }).catch(function () {
        flyerMsg.textContent = "Couldn't make the image. Try again.";
      });
    });
  });

  // On phones this opens the share sheet (Instagram, Facebook, Messages, Save image…)
  flyerShare.addEventListener("click", function () {
    if (!flyerBlob) return;
    var file = new File([flyerBlob], flyerDownload.dataset.name || "schedule.png", { type: "image/png" });
    navigator.share({ files: [file] }).catch(function () { /* cancelled */ });
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });
})();
