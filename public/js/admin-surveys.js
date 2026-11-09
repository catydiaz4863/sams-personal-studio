// Sam's reviews & surveys page: approve reviews, build surveys, share links,
// see results, download a spreadsheet.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;
  var $ = function (id) { return document.getElementById(id); };

  var surveys = [];        // all surveys (review first)
  var reviewOpen = true;
  var reviews = [];        // responses to the class review
  var filter = "new";
  var cache = {};          // survey id -> responses
  var events = [];         // studio events, for attaching surveys

  var TYPE_LABELS = { stars: "Stars (1–5)", scale: "0–10 scale", choice: "Pick one", multi: "Pick any", text: "Short answer", long: "Long answer" };

  function api(path, opts) {
    return fetch(path, Object.assign({ cache: "no-store" }, opts || {}))
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
      .then(function (res) {
        if (res.status === 401) { showLogin(); throw new Error(res.body.error); }
        if (!res.ok) throw new Error(res.body.error || "Something went wrong.");
        return res.body;
      });
  }
  function msg(t) { $("sv-msg").textContent = t || ""; }
  function showLogin() { $("loading").hidden = true; $("app").hidden = true; $("need-login").hidden = false; }
  function linkFor(s) { return location.origin + "/survey?id=" + encodeURIComponent(s.id); }
  function fmtDate(t) { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function starText(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }

  fetch("/api/session", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (s) {
    if (!s.loggedIn) return showLogin();
    return Promise.all([api("/api/admin/surveys"), api("/api/admin/responses?survey=review"), api("/api/schedule")]).then(function (res) {
      events = (res[2].events || []).filter(function (e) { return e.id; });
      surveys = res[0].surveys;
      reviewOpen = surveys[0].open;
      reviews = res[1].responses;
      cache.review = reviews;
      $("loading").hidden = true;
      $("app").hidden = false;
      renderReviews();
      renderSurveys();
    });
  }).catch(function (e) { $("loading").textContent = e.message || "Couldn't load. Refresh the page."; });

  // ---------------- reviews ----------------
  $("rv-filter").addEventListener("click", function (e) {
    var b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.getAttribute("data-f");
    renderReviews();
  });

  function renderReviews() {
    ["new", "approved", "hidden"].forEach(function (k) {
      var n = reviews.filter(function (r) { return r.st === k; }).length;
      $("n-" + k).textContent = n ? "(" + n + ")" : "";
    });
    $("rv-filter").querySelectorAll("[data-f]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-f") === filter)); });
    var list = $("rv-admin-list");
    list.textContent = "";
    var shown = reviews.filter(function (r) { return r.st === filter; });
    if (!shown.length) {
      list.appendChild(el("p", { class: "ed-empty", text: filter === "new" ? "No new reviews. Share your review link to get some!" : "Nothing here yet." }));
      return;
    }
    shown.forEach(function (r) { list.appendChild(reviewCard(r)); });
  }

  function reviewCard(r) {
    var a = r.a;
    var kids = [
      el("div", { class: "rva-top" }, [
        el("span", { class: "rv-stars", text: starText(a.stars || 0) }),
        el("span", { class: "rva-date", text: fmtDate(r.t) })
      ]),
      el("strong", { text: a.class || "" })
    ];
    if (a.comment) kids.push(el("p", { class: "rv-text", text: "“" + a.comment + "”" }));
    if (a.tags && a.tags.length) kids.push(el("p", { class: "rva-tags", text: a.tags.join(" · ") }));
    kids.push(el("p", { class: "rva-meta", text: "– " + (a.name || "No name") }));
    var priv = [];
    if (a.heard) priv.push("Heard via " + a.heard);
    if (a.recommend != null) priv.push("Recommend " + a.recommend + "/10");
    if (a.tenure) priv.push(a.tenure);
    if (priv.length) kids.push(el("p", { class: "rva-private", text: "Private: " + priv.join(" · ") }));

    var actions = el("div", { class: "rva-actions" });
    function btn(label, cls, fn) { var b = el("button", { type: "button", class: cls, text: label }); b.addEventListener("click", fn); actions.appendChild(b); }
    if (r.st !== "approved") btn("Approve", "sheet-done", function () { update(r, { status: "approved" }); });
    if (r.st === "approved") {
      btn(r.f ? "★ Featured" : "☆ Feature", r.f ? "sheet-done" : "sheet-cancel", function () { update(r, { featured: !r.f }); });
      if (a.comment) btn("Copy quote", "sheet-cancel", function () { copy("“" + a.comment + "” – " + shortName(a.name), "Quote copied. Paste it into a post!"); });
    }
    if (r.st !== "hidden") btn("Hide", "sheet-cancel", function () { update(r, { status: "hidden" }); });
    if (r.st === "hidden") btn("Delete", "sheet-delete", function () {
      if (confirm("Delete this review for good?")) update(r, { remove: true });
    });
    kids.push(actions);
    return el("article", { class: "rva-card", "data-cat": S.categoryOf(a.class || "") }, kids);
  }

  function shortName(raw) {
    var p = String(raw || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "A student";
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    return p.length > 1 ? cap(p[0]) + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : cap(p[0]);
  }

  function update(r, change) {
    api("/api/admin/responses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ survey: "review", id: r.id }, change))
    }).then(function () {
      if (change.remove) reviews = reviews.filter(function (x) { return x !== r; });
      if (change.status) r.st = change.status;
      if (typeof change.featured === "boolean") r.f = change.featured;
      renderReviews();
      msg(change.status === "approved" ? "Approved. It's on the website now." : "");
    }).catch(function (e) { msg(e.message); });
  }

  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { msg(done); })
      .catch(function () { window.prompt("Copy this:", text); });
  }

  // ---------------- surveys ----------------
  function renderSurveys() {
    var list = $("survey-list");
    list.textContent = "";
    surveys.forEach(function (s) {
      var row = el("div", { class: "svl-row" }, [
        el("div", { class: "svl-text" }, [
          el("strong", { text: s.title }),
          el("span", { class: "svl-sub", text: (s.kind === "review" ? "Class reviews" : whereText(s)) + " · " + s.questions.length + (s.questions.length === 1 ? " question · " : " questions · ") + (s.open ? "Open" : "Closed") })
        ])
      ]);
      var actions = el("div", { class: "svl-actions" });
      function btn(label, fn, cls) { var b = el("button", { type: "button", class: cls || "chip", text: label }); b.addEventListener("click", fn); actions.appendChild(b); }
      btn("Copy link", function () { copy(linkFor(s), "Link copied: " + linkFor(s)); });
      if (navigator.share) btn("Share", function () { navigator.share({ title: s.title, url: linkFor(s) }).catch(function () {}); });
      btn("Results", function () { openResults(s); });
      btn("Edit", function () { openBuilder(s); });
      btn(s.open ? "Close it" : "Open it", function () { s.open = !s.open; saveSurveys(); });
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function eventById(id) { return events.filter(function (e) { return e.id === id; })[0]; }
  function eventText(e) { return e.title + " (" + S.formatDate(e.date, { month: "short", day: "numeric" }) + ")"; }
  function whereText(s) {
    if (!s.event) return "General";
    var e = eventById(s.event);
    return e ? "Event: " + eventText(e) : "Event (removed)";
  }

  function saveSurveys() {
    var custom = surveys.filter(function (s) { return s.kind !== "review"; });
    var reviewS = surveys.filter(function (s) { return s.kind === "review"; })[0];
    return api("/api/admin/surveys", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewOpen: reviewS ? reviewS.open : true, surveys: custom,
        review: reviewS ? { title: reviewS.title, intro: reviewS.intro, questions: reviewS.questions } : null })
    }).then(function (body) {
      surveys = body.surveys;
      renderSurveys();
      msg("Saved.");
    }).catch(function (e) { msg(e.message); throw e; });
  }

  // ---------------- results ----------------
  var resultsSurvey = null;
  var range = "all";
  $("res-range").addEventListener("click", function (e) {
    var b = e.target.closest("[data-r]");
    if (!b) return;
    range = b.getAttribute("data-r");
    $("res-range").querySelectorAll("[data-r]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    drawResults();
  });
  $("res-close").addEventListener("click", function () { $("results").close(); });
  $("results").addEventListener("click", function (e) { if (e.target === $("results")) $("results").close(); });

  function openResults(s) {
    resultsSurvey = s;
    $("res-title").textContent = s.title;
    $("res-body").textContent = "Loading…";
    $("results").showModal();
    var load = cache[s.id] ? Promise.resolve(cache[s.id]) : api("/api/admin/responses?survey=" + encodeURIComponent(s.id)).then(function (b) { cache[s.id] = b.responses; return b.responses; });
    load.then(drawResults).catch(function (e) { $("res-body").textContent = e.message; });
  }

  function inRange() {
    var all = cache[resultsSurvey.id] || [];
    if (range === "all") return all;
    var since = Date.now() - Number(range) * 864e5;
    return all.filter(function (r) { return r.t >= since; });
  }

  function bars(rows, total) {
    var wrap = el("div", { class: "res-bars" });
    rows.forEach(function (row) {
      var pct = total ? Math.round(row[1] / total * 100) : 0;
      var bar = el("div", { class: "res-bar" }, [el("span", { class: "res-fill" })]);
      bar.firstChild.style.width = pct + "%";
      wrap.appendChild(el("div", { class: "res-row" }, [
        el("span", { class: "res-label", text: row[0] }), bar, el("span", { class: "res-num", text: row[1] + " · " + pct + "%" })
      ]));
    });
    return wrap;
  }

  function drawResults() {
    var s = resultsSurvey;
    var list = inRange();
    var body = $("res-body");
    body.textContent = "";
    body.appendChild(el("p", { class: "res-total", text: list.length + (list.length === 1 ? " response" : " responses") }));
    if (!list.length) return;

    // Review survey: stars by class first, it's the main question.
    if (s.kind === "review") {
      var byClass = {};
      list.forEach(function (r) { var c = r.a.class; if (!c) return; (byClass[c] = byClass[c] || []).push(r.a.stars); });
      var rows = Object.keys(byClass).map(function (c) {
        var v = byClass[c]; return [c, v.reduce(function (a, b) { return a + b; }, 0) / v.length, v.length];
      }).sort(function (a, b) { return b[1] - a[1]; });
      var t = el("div", { class: "res-q" }, [el("h3", { text: "Average stars by class" })]);
      rows.forEach(function (r) {
        t.appendChild(el("div", { class: "res-row" }, [
          el("span", { class: "res-label", text: r[0] }),
          el("span", { class: "rv-stars", text: starText(Math.round(r[1])) }),
          el("span", { class: "res-num", text: r[1].toFixed(1) + " (" + r[2] + ")" })
        ]));
      });
      body.appendChild(t);
    }

    s.questions.forEach(function (q) {
      if (s.kind === "review" && q.id === "class") return;
      var vals = list.map(function (r) { return r.a[q.id]; }).filter(function (v) { return v !== undefined && v !== "" && !(Array.isArray(v) && !v.length); });
      var box = el("div", { class: "res-q" }, [el("h3", { text: q.label })]);
      box.appendChild(el("p", { class: "res-sub", text: vals.length + " answered" + (q.private ? " · private" : "") }));
      if (!vals.length) { body.appendChild(box); return; }

      if (q.type === "stars") {
        var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        box.appendChild(el("p", { class: "res-big", text: avg.toFixed(1) + " ★" }));
        box.appendChild(bars([5, 4, 3, 2, 1].map(function (n) { return [n + " ★", vals.filter(function (v) { return v === n; }).length]; }), vals.length));
      } else if (q.type === "scale") {
        var pro = vals.filter(function (v) { return v >= 9; }).length, det = vals.filter(function (v) { return v <= 6; }).length;
        var score = Math.round((pro - det) / vals.length * 100);
        box.appendChild(el("p", { class: "res-big", text: "Score " + (score > 0 ? "+" : "") + score }));
        box.appendChild(el("p", { class: "res-sub", text: "Love it (9–10): " + pro + " · Neutral (7–8): " + (vals.length - pro - det) + " · Unhappy (0–6): " + det + ". Above 0 is good, above 50 is excellent." }));
      } else if (q.type === "choice" || q.type === "multi" || q.type === "class") {
        var counts = {};
        vals.forEach(function (v) { [].concat(v).forEach(function (x) { counts[x] = (counts[x] || 0) + 1; }); });
        var rows2 = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
        box.appendChild(bars(rows2, vals.length));
      } else {
        var ul = el("ul", { class: "res-texts" });
        vals.slice(0, 15).forEach(function (v) { ul.appendChild(el("li", { text: v })); });
        box.appendChild(ul);
        if (vals.length > 15) box.appendChild(el("p", { class: "res-sub", text: "+ " + (vals.length - 15) + " more in the spreadsheet" }));
      }
      body.appendChild(box);
    });
  }

  // Spreadsheet (CSV opens in Excel, Numbers and Google Sheets)
  $("res-csv").addEventListener("click", function () {
    var s = resultsSurvey;
    var rows = inRange();
    var head = ["Date"].concat(s.questions.map(function (q) { return q.label; }));
    if (s.kind === "review") head.push("Status", "Featured");
    var esc = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [head.map(esc).join(",")];
    rows.forEach(function (r) {
      var line = [new Date(r.t).toISOString().slice(0, 10)].concat(s.questions.map(function (q) {
        var v = r.a[q.id]; return Array.isArray(v) ? v.join("; ") : v;
      }));
      if (s.kind === "review") line.push(r.st, r.f ? "yes" : "");
      lines.push(line.map(esc).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey") + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
  });

  // ---------------- survey builder ----------------
  var draft = null;
  $("new-survey").addEventListener("click", function () { openBuilder(null); });
  $("b-cancel").addEventListener("click", function () { $("builder").close(); });
  $("builder").addEventListener("click", function (e) { if (e.target === $("builder")) $("builder").close(); });

  function openBuilder(s) {
    draft = s ? JSON.parse(JSON.stringify(s)) : { id: "", kind: "custom", title: "", intro: "", open: true, event: "", questions: [{ type: "choice", label: "", options: [], required: true }] };
    draft.questions.forEach(function (q) { if (q.type === "text" && q.long) q.type = "long"; });
    $("b-title").textContent = s ? "Edit survey" : "New survey";
    $("b-name").value = draft.title;
    $("b-intro").value = draft.intro || "";
    $("b-delete").hidden = !s || draft.kind === "review";
    $("b-where-wrap").hidden = draft.kind === "review";
    $("b-review-note").hidden = draft.kind !== "review";
    drawWhere();
    $("b-error").textContent = "";
    drawQuestions();
    $("builder").showModal();
  }

  // Where the survey shows: general link, or on one event's card
  function drawWhere() {
    var holder = $("b-where");
    holder.textContent = "";
    var today = S.localDateKey();
    var since = new Date(Date.now() - 30 * 864e5);
    var sinceKey = S.localDateKey(since);
    var list = events.filter(function (e) { return e.date >= sinceKey || e.id === draft.event; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    function chip(label, value) {
      var b = el("button", { type: "button", class: "chip", "aria-pressed": String((draft.event || "") === value), text: label });
      b.addEventListener("click", function () { draft.event = value; drawWhere(); });
      holder.appendChild(b);
    }
    chip("General (just a link)", "");
    list.forEach(function (e) { chip((e.date < today ? "Past: " : "") + eventText(e), e.id); });
    $("b-where-hint").textContent = draft.event
      ? "A button to this survey shows on that event's card, and for 2 weeks after the event."
      : list.length ? "Only people with the link can answer it." : "Only people with the link can answer it. Add events on the Schedule page to attach surveys to them.";
  }

  function drawQuestions() {
    var holder = $("b-questions");
    holder.textContent = "";
    draft.questions.forEach(function (q, i) {
      if (q.locked) {
        var lab = el("input", { class: "sheet-input", type: "text", maxlength: "140" });
        lab.value = q.label;
        lab.addEventListener("input", function () { q.label = lab.value; });
        holder.appendChild(el("div", { class: "bq bq-locked" }, [
          el("span", { class: "bq-num", text: "Question " + (i + 1) + " · built in" }),
          lab,
          el("p", { class: "hint", text: "Needed for reviews on the website. You can reword it, but not remove it." })
        ]));
        return;
      }
      var types = el("div", { class: "chips bq-types" });
      Object.keys(TYPE_LABELS).forEach(function (t) {
        var b = el("button", { type: "button", class: "chip", "aria-pressed": String(q.type === t), text: TYPE_LABELS[t] });
        b.addEventListener("click", function () { q.type = t; drawQuestions(); });
        types.appendChild(b);
      });
      var label = el("input", { class: "sheet-input", type: "text", maxlength: "140", placeholder: "Question " + (i + 1) });
      label.value = q.label;
      label.addEventListener("input", function () { q.label = label.value; });
      var kids = [el("span", { class: "bq-num", text: "Question " + (i + 1) }), label, types];
      if (q.type === "choice" || q.type === "multi") {
        var opts = el("textarea", { class: "sheet-input", rows: "4", placeholder: "One option per line" });
        opts.value = (q.options || []).join("\n");
        opts.addEventListener("input", function () { q.options = opts.value.split("\n"); });
        kids.push(opts);
      }
      var req = el("label", { class: "bq-req" }, [el("input", { type: "checkbox" }), document.createTextNode(" Required")]);
      req.firstChild.checked = !!q.required;
      req.firstChild.addEventListener("change", function () { q.required = req.firstChild.checked; });
      var tools = el("div", { class: "bq-tools" }, [req]);
      if (draft.kind === "review") {
        var priv = el("label", { class: "bq-req" }, [el("input", { type: "checkbox" }), document.createTextNode(" Private")]);
        priv.firstChild.checked = !!q.private;
        priv.firstChild.addEventListener("change", function () { q.private = priv.firstChild.checked; });
        priv.title = "Only you see private answers; they never show on the website.";
        tools.insertBefore(priv, req.nextSibling);
      }
      function tool(text, fn, disabled) { var b = el("button", { type: "button", class: "chip", text: text }); if (disabled) b.disabled = true; b.addEventListener("click", fn); tools.appendChild(b); }
      tool("↑", function () { draft.questions.splice(i - 1, 0, draft.questions.splice(i, 1)[0]); drawQuestions(); }, i === 0 || draft.questions[i - 1].locked);
      tool("↓", function () { draft.questions.splice(i + 1, 0, draft.questions.splice(i, 1)[0]); drawQuestions(); }, i === draft.questions.length - 1);
      tool("Remove", function () { draft.questions.splice(i, 1); drawQuestions(); }, draft.questions.filter(function (x) { return !x.locked; }).length === 1 && draft.kind !== "review");
      kids.push(tools);
      holder.appendChild(el("div", { class: "bq" }, kids));
    });
  }

  $("b-add").addEventListener("click", function () {
    draft.questions.push({ type: "choice", label: "", options: [], required: false });
    drawQuestions();
    var last = $("b-questions").lastChild;
    last.scrollIntoView({ behavior: "smooth", block: "center" });
    last.querySelector("input").focus();
  });

  $("b-form").addEventListener("submit", function (e) {
    e.preventDefault();
    draft.title = $("b-name").value.trim();
    draft.intro = $("b-intro").value.trim();
    if (!draft.title) { $("b-error").textContent = "Give the survey a title."; return; }
    var out = JSON.parse(JSON.stringify(draft));
    out.questions = out.questions.filter(function (q) { return q.label.trim(); }).map(function (q) {
      var long = q.type === "long";
      var item = { id: q.id, type: long ? "text" : q.type, label: q.label.trim(), required: !!q.required };
      if (q.private) item.private = true;
      if (q.locked) item.locked = true;
      if (long) item.long = true;
      if (q.type === "choice" || q.type === "multi") item.options = (q.options || []).map(function (o) { return o.trim(); }).filter(Boolean);
      return item;
    });
    if (!out.questions.length) { $("b-error").textContent = "Add at least one question."; return; }
    out.event = draft.event || "";
    var bad = out.questions.filter(function (q) { return (q.type === "choice" || q.type === "multi") && q.options.length < 2; })[0];
    if (bad) { $("b-error").textContent = "“" + bad.label + "” needs at least 2 options (one per line)."; return; }
    var i = surveys.findIndex(function (s) { return draft.id && s.id === draft.id; });
    var before = surveys.slice();
    if (i === -1) surveys.push(out); else surveys[i] = out;
    saveSurveys().then(function () {
      $("builder").close();
      msg(i === -1 ? "Survey created. Tap Copy link to share it." : "Survey saved.");
    }).catch(function (err) { surveys = before; $("b-error").textContent = err.message; });
  });

  $("b-delete").addEventListener("click", function () {
    if (!confirm("Delete this survey? Its link will stop working.")) return;
    var before = surveys.slice();
    surveys = surveys.filter(function (s) { return s.id !== draft.id; });
    saveSurveys().then(function () { $("builder").close(); msg("Survey deleted. Its past answers are kept in storage."); })
      .catch(function () { surveys = before; });
  });
})();
