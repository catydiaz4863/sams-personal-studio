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

  // ---------- editor: one entry per class + time, with its days ----------
  var CLASS_MINUTES = 60;          // used to spot classes that overlap
  var OTHER = "__other";
  var listEl = $("class-list");
  var conflictsEl = $("conflicts");
  var undoBtn = $("undo");
  var sheet = $("class-sheet");
  var settingsSheet = $("settings-sheet");
  var entries = [];               // [{ id, name, days: ["mon","wed"], time: "10:00" }]
  var nextId = 1;
  var knownNames = [];
  var editing = null;             // the entry being edited in the sheet (a copy)
  var undoState = null;
  var undoTimer = null;
  var DAY_KEYS = S.DAYS.map(function (d) { return d.key; });

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
  function dayShort(k) { return S.DAYS[DAY_KEYS.indexOf(k)].short; }
  function daysText(days) {
    var names = days.slice().sort(function (a, b) { return DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b); }).map(dayShort);
    return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  }

  function fillEditor(data) {
    $("month").value = data.month || "";
    $("note").value = data.note || "";
    var prices = S.pricesOf(data);
    $("price-twice").value = prices.twice;
    $("price-once").value = prices.once;
    $("price-registration").value = prices.registration;

    knownNames = KNOWN_NAMES.slice();
    entries = [];
    var byKey = {};
    (data.classes || []).forEach(function (c) {
      if (knownNames.indexOf(c.name) === -1) knownNames.push(c.name);
      var key = c.name + "|" + c.time;
      if (!byKey[key]) { byKey[key] = { id: nextId++, name: c.name, time: c.time, days: [] }; entries.push(byKey[key]); }
      if (byKey[key].days.indexOf(c.day) === -1) byKey[key].days.push(c.day);
    });
    dirty = false;
    render();
    setMsg("All changes saved.", "");
  }

  // ---- overlap check: same day, starts less than an hour apart ----
  function findConflicts(list) {
    var slots = [];
    list.forEach(function (e) { e.days.forEach(function (d) { slots.push({ id: e.id, name: e.name, day: d, time: e.time }); }); });
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      for (var j = i + 1; j < slots.length; j++) {
        var a = slots[i], b = slots[j];
        if (a.day !== b.day || a.id === b.id) continue;
        if (Math.abs(minutes(a.time) - minutes(b.time)) >= CLASS_MINUTES) continue;
        var same = a.name === b.name && a.time === b.time;
        out.push({ a: a, b: b, same: same,
          text: dayShort(a.day) + ": " + a.name + " " + S.formatTime(a.time) +
            (same ? " is listed twice" : " overlaps " + b.name + " " + S.formatTime(b.time)) });
      }
    }
    return out;
  }
  // Plain-language warnings for one entry, with matching days combined:
  // "Overlaps Pole Level 1 & 2 at 11:00 AM on Mon & Wed"
  function conflictsFor(id, conflicts) {
    var groups = {};
    var order = [];
    conflicts.forEach(function (c) {
      if (c.a.id !== id && c.b.id !== id) return;
      var other = c.a.id === id ? c.b : c.a;
      var key = (c.same ? "same|" : "") + other.name + "|" + other.time;
      if (!groups[key]) { groups[key] = { same: c.same, name: other.name, time: other.time, days: [] }; order.push(key); }
      if (groups[key].days.indexOf(other.day) === -1) groups[key].days.push(other.day);
    });
    return order.map(function (k) {
      var g = groups[k];
      return g.same ? "Listed twice on " + daysText(g.days) :
        "Overlaps " + g.name + " at " + S.formatTime(g.time) + " on " + daysText(g.days);
    });
  }

  // ---- the list ----
  function render() {
    var conflicts = findConflicts(entries);
    listEl.textContent = "";
    if (!entries.length) {
      listEl.appendChild(el("p", { class: "ed-empty", text: "No classes yet. Tap “+ Add a class” to start." }));
    }
    var cats = S.CATEGORIES;
    cats.forEach(function (cat) {
      var mine = entries.filter(function (e) { return S.categoryOf(e.name) === cat.key; })
        .sort(function (a, b) {
          return a.name.localeCompare(b.name) ||
            DAY_KEYS.indexOf(a.days.slice().sort(function (x, y) { return DAY_KEYS.indexOf(x) - DAY_KEYS.indexOf(y); })[0]) -
            DAY_KEYS.indexOf(b.days.slice().sort(function (x, y) { return DAY_KEYS.indexOf(x) - DAY_KEYS.indexOf(y); })[0]) ||
            (a.time < b.time ? -1 : 1);
        });
      if (!mine.length) return;
      var group = el("div", { class: "ed-group" });
      mine.forEach(function (e) {
        var warns = conflictsFor(e.id, conflicts);
        var text = [el("span", { class: "ed-name", text: e.name }),
          el("span", { class: "ed-when", text: daysText(e.days) + " · " + S.formatTime(e.time) })];
        if (warns.length) text.push(el("span", { class: "ed-warn", text: warns[0] + (warns.length > 1 ? " (+" + (warns.length - 1) + " more)" : "") }));
        var item = el("button", { type: "button", class: "ed-item" + (warns.length ? " has-conflict" : ""), "data-cat": cat.key }, [
          el("span", { class: "ed-bar" }),
          el("span", { class: "ed-text" }, text),
          el("span", { class: "ed-chev", text: "›" })
        ]);
        item.addEventListener("click", function () { openSheet(e); });
        group.appendChild(item);
      });
      listEl.appendChild(el("h2", { class: "ed-group-title", "data-cat": cat.key, text: cat.label }));
      listEl.appendChild(group);
    });

    conflictsEl.textContent = "";
    conflictsEl.hidden = !conflicts.length;
    if (conflicts.length) {
      conflictsEl.appendChild(el("strong", { text: conflicts.length === 1 ? "1 time conflict" : conflicts.length + " time conflicts" }));
      var ul = el("ul");
      conflicts.forEach(function (c) { ul.appendChild(el("li", { text: c.text })); });
      conflictsEl.appendChild(ul);
    }
    $("admin-sub").textContent = ($("month").value || "No month set") + " · Tap a class to change it.";
    return conflicts;
  }
  var refresh = render;

  // ---- the edit sheet ----
  var nameChips = $("name-chips");
  var dayChips = $("day-chips");
  var customName = $("custom-name");
  var timeSelect = $("time-select");
  var sheetWarn = $("sheet-warn");
  var sheetError = $("sheet-error");

  function chip(label, pressed, cat) {
    var b = el("button", { type: "button", class: "chip", "aria-pressed": String(pressed) });
    if (cat) { b.setAttribute("data-cat", cat); b.appendChild(el("span", { class: "chip-dot" })); }
    b.appendChild(document.createTextNode(label));
    return b;
  }

  function draftName() {
    return editing.name === OTHER ? customName.value.trim() : editing.name;
  }

  function drawSheet() {
    nameChips.textContent = "";
    knownNames.forEach(function (n) {
      var b = chip(n, editing.name === n, S.categoryOf(n));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(editing.name === n));
      b.addEventListener("click", function () { editing.name = n; drawSheet(); });
      nameChips.appendChild(b);
    });
    var other = chip("Other…", editing.name === OTHER);
    other.setAttribute("role", "radio");
    other.setAttribute("aria-checked", String(editing.name === OTHER));
    other.addEventListener("click", function () { editing.name = OTHER; drawSheet(); customName.focus(); });
    nameChips.appendChild(other);
    customName.hidden = editing.name !== OTHER;

    dayChips.textContent = "";
    S.DAYS.forEach(function (d) {
      var on = editing.days.indexOf(d.key) !== -1;
      var b = chip(d.short, on);
      b.setAttribute("aria-label", d.long);
      b.addEventListener("click", function () {
        var i = editing.days.indexOf(d.key);
        if (i === -1) editing.days.push(d.key); else editing.days.splice(i, 1);
        drawSheet();
      });
      dayChips.appendChild(b);
    });
    updateSheetWarn();
  }

  function updateSheetWarn() {
    var name = draftName();
    var time = timeSelect.value;
    sheetWarn.hidden = true;
    if (!name || !time || !editing.days.length) return;
    var draft = { id: "draft", name: name, time: time, days: editing.days };
    var others = entries.filter(function (e) { return e.id !== editing.id; });
    var msgs = conflictsFor("draft", findConflicts(others.concat([draft])));
    if (msgs.length) {
      sheetWarn.hidden = false;
      sheetWarn.textContent = "Heads up: " + msgs.join(". ") + ".";
    }
  }

  function openSheet(entry) {
    editing = entry ? { id: entry.id, name: entry.name, time: entry.time, days: entry.days.slice() }
                    : { id: null, name: "", time: "", days: [] };
    if (editing.name && knownNames.indexOf(editing.name) === -1) { customName.value = editing.name; editing.name = OTHER; }
    else customName.value = "";
    $("sheet-title").textContent = entry ? "Change class" : "New class";
    $("sheet-delete").hidden = !entry;
    sheetError.textContent = "";

    timeSelect.textContent = "";
    timeSelect.appendChild(el("option", { value: "", text: "Pick a time" }));
    var times = TIME_OPTIONS.slice();
    if (editing.time && times.indexOf(editing.time) === -1) { times.push(editing.time); times.sort(); }
    times.forEach(function (t) { timeSelect.appendChild(el("option", { value: t, text: S.formatTime(t) })); });
    timeSelect.value = editing.time || "";

    drawSheet();
    sheet.showModal();
    sheet.querySelector(".sheet-inner").scrollTop = 0;
  }

  timeSelect.addEventListener("change", updateSheetWarn);
  customName.addEventListener("input", updateSheetWarn);
  $("sheet-cancel").addEventListener("click", function () { sheet.close(); });
  // tap the dark area around the sheet to close it
  [sheet, settingsSheet].forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });

  $("class-form").addEventListener("submit", function (e) {
    var name = draftName();
    var time = timeSelect.value;
    var missing = !name ? "Pick a class." : !editing.days.length ? "Pick at least one day." : !time ? "Pick a time." : "";
    if (missing) { e.preventDefault(); sheetError.textContent = missing; return; }
    var saved = { id: editing.id || nextId++, name: name, time: time, days: editing.days.slice() };
    var i = entries.findIndex(function (x) { return x.id === saved.id; });
    if (i === -1) entries.push(saved); else entries[i] = saved;
    if (knownNames.indexOf(name) === -1) knownNames.push(name);
    markDirty();
  });

  $("sheet-delete").addEventListener("click", function () {
    var i = entries.findIndex(function (x) { return x.id === editing.id; });
    if (i === -1) return;
    undoState = { entry: entries[i], index: i };
    entries.splice(i, 1);
    sheet.close();
    markDirty();
    setMsg("Class removed.", "warn");
    undoBtn.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoBtn.hidden = true; undoState = null; }, 10000);
  });
  undoBtn.addEventListener("click", function () {
    if (!undoState) return;
    entries.splice(undoState.index, 0, undoState.entry);
    undoState = null;
    undoBtn.hidden = true;
    markDirty();
  });

  $("add-class").addEventListener("click", function () { openSheet(null); });

  // ---- month & prices sheet ----
  $("open-settings").addEventListener("click", function () { $("settings-error").textContent = ""; settingsSheet.showModal(); });
  settingsSheet.addEventListener("input", markDirty);
  settingsSheet.querySelector("form").addEventListener("submit", function (e) {
    var bad = ["twice", "once", "registration"].some(function (k) { var v = $("price-" + k).value.trim(); return v !== "" && !/^\d{1,4}$/.test(v); });
    if (bad) { e.preventDefault(); $("settings-error").textContent = "Prices must be whole dollars, like 100."; }
    render();
  });

  function markDirty() {
    dirty = true;
    setMsg("You have unsaved changes.", "warn");
    render();
  }

  function setMsg(text, kind) {
    saveMsg.textContent = text;
    saveMsg.className = kind || "";
  }

  // Show a problem field (only prices can be invalid now).
  function reveal(node) {
    if (node.closest("#settings-sheet")) { settingsSheet.showModal(); node.focus(); }
  }

  function collect() {
    var classes = [];
    entries.forEach(function (e) {
      e.days.forEach(function (d) { classes.push({ day: d, time: e.time, name: e.name }); });
    });
    var problem = null;
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
      setMsg("Prices must be whole dollars. Check Month & prices.", "error");
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
        flyerMsg.textContent = "Prices must be whole dollars. Check Month & prices.";
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
