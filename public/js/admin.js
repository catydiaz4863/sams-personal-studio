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

  function fillEditor(data) {
    $("month").value = data.month || "";
    $("note").value = data.note || "";

    var names = new Set(KNOWN_NAMES);
    (data.classes || []).forEach(function (c) { names.add(c.name); });
    var dl = $("class-names");
    dl.textContent = "";
    names.forEach(function (n) { dl.appendChild(el("option", { value: n })); });

    daysEl.textContent = "";
    S.DAYS.forEach(function (d) {
      var rows = el("div", { class: "admin-rows" });
      var addBtn = el("button", { type: "button", class: "btn btn-ghost btn-small", text: "+ Add a class" });
      addBtn.addEventListener("click", function () {
        var row = makeRow({ time: "", name: "" });
        rows.appendChild(row);
        row.querySelector("input[type=time]").focus();
        markDirty();
      });
      var card = el("section", { class: "admin-card admin-day", "data-day": d.key }, [
        el("h3", { text: d.long }), rows, addBtn
      ]);
      S.sortClasses((data.classes || []).filter(function (c) { return c.day === d.key; }))
        .forEach(function (c) { rows.appendChild(makeRow(c)); });
      daysEl.appendChild(card);
    });

    dirty = false;
    setMsg("All changes saved.", "");
  }

  function makeRow(c) {
    var time = el("input", { type: "time", value: c.time || "", "aria-label": "Start time", step: "300" });
    var name = el("input", { type: "text", value: c.name || "", list: "class-names", maxlength: "60", "aria-label": "Class name", placeholder: "Class name" });
    var swatch = el("span", { class: "swatch", "data-cat": S.categoryOf(c.name) });
    var remove = el("button", { type: "button", class: "remove", "aria-label": "Remove this class", text: "✕" });
    var row = el("div", { class: "admin-row" }, [time, el("div", { class: "name-wrap" }, [swatch, name]), remove]);

    name.addEventListener("input", function () { swatch.setAttribute("data-cat", S.categoryOf(name.value)); });
    remove.addEventListener("click", function () { row.remove(); markDirty(); });
    return row;
  }

  editorView.addEventListener("input", markDirty);

  function markDirty() {
    dirty = true;
    setMsg("You have unsaved changes.", "warn");
  }

  function setMsg(text, kind) {
    saveMsg.textContent = text;
    saveMsg.className = kind || "";
  }

  function collect() {
    var classes = [];
    var problem = null;
    daysEl.querySelectorAll(".admin-day").forEach(function (card) {
      var day = card.getAttribute("data-day");
      card.querySelectorAll(".admin-row").forEach(function (row) {
        var time = row.querySelector("input[type=time]");
        var name = row.querySelector("input[type=text]");
        row.classList.remove("has-error");
        if (!name.value.trim() && !time.value) return; // empty row, skip
        if (!name.value.trim() || !time.value) {
          row.classList.add("has-error");
          problem = problem || row;
          return;
        }
        classes.push({ day: day, time: time.value, name: name.value.trim() });
      });
    });
    return { problem: problem, data: { month: $("month").value, note: $("note").value, classes: classes } };
  }

  saveBtn.addEventListener("click", function () {
    var result = collect();
    if (result.problem) {
      setMsg("Each class needs both a time and a name.", "error");
      result.problem.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
        flyerMsg.textContent = "Fix the highlighted class first (it needs a time and a name).";
        result.problem.scrollIntoView({ behavior: "smooth", block: "center" });
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
