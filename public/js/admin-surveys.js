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
  var toastTimer = null;
  function msg(t) {
    var box = $("sv-msg");
    box.textContent = t || "";
    box.classList.toggle("show", !!t);
    clearTimeout(toastTimer);
    if (t) toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3500);
  }
  function showLogin() { $("loading").hidden = true; $("app").hidden = true; $("need-login").hidden = false; }
  function linkFor(s) { return location.origin + "/survey?id=" + encodeURIComponent(s.id); }
  function fmtDate(t) { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function starText(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }

  fetch("/api/session", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (s) {
    if (!s.loggedIn) return showLogin();
    return Promise.all([api("/api/admin/surveys"), api("/api/schedule")]).then(function (res) {
      events = (res[1].events || []).filter(function (e) { return e.id; });
      surveys = res[0].surveys;
      templates = res[0].templates || [];
      reviewOpen = surveys[0].open;
      return loadAllResponses();
    }).then(function () {
      reviews = cache.review || [];
      $("loading").hidden = true;
      $("app").hidden = false;
      renderAll();
    });
  }).catch(function (e) { $("loading").textContent = e.message || "Couldn't load. Refresh the page."; });

  // ---------------- data + range ----------------
  var range = "30";
  function loadAllResponses() {
    return Promise.all(surveys.map(function (s) {
      return api("/api/admin/responses?survey=" + encodeURIComponent(s.id)).then(function (b) { cache[s.id] = b.responses; });
    }));
  }
  function withinRange(list, offsetDays) {
    if (range === "all") return offsetDays ? [] : list;
    var days = Number(range), now = Date.now(), off = (offsetDays || 0) * 864e5;
    return list.filter(function (r) { return r.t >= now - off - days * 864e5 && r.t < now - off; });
  }
  function rangeLabel() { return range === "all" ? "all time" : range === "30" ? "last 30 days" : "last 3 months"; }
  function allResponses() {
    var out = [];
    surveys.forEach(function (s) { out = out.concat(cache[s.id] || []); });
    return out;
  }
  $("range").addEventListener("change", function () { range = this.value; renderAll(); });

  function renderAll() { renderOverview(); renderReviews(); renderSurveys(); }

  // ---------------- tabs ----------------
  document.querySelector(".dash-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (b) showTab(b.getAttribute("data-tab"));
  });
  function showTab(name) {
    document.querySelectorAll(".dash-tabs [data-tab]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tab") === name)); });
    document.querySelectorAll(".dash-panel").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
    window.scrollTo(0, 0);
  }

  // ---------------- small chart helpers (plain SVG) ----------------
  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  // progress ring, value 0..1
  function ring(value, color) {
    var r = 15, c = 2 * Math.PI * r;
    var s = svg("svg", { viewBox: "0 0 40 40", class: "ring", "aria-hidden": "true" });
    s.appendChild(svg("circle", { cx: 20, cy: 20, r: r, fill: "none", stroke: "rgba(23,19,26,0.1)", "stroke-width": 4 }));
    var v = Math.max(0, Math.min(1, value || 0));
    s.appendChild(svg("circle", { cx: 20, cy: 20, r: r, fill: "none", stroke: color, "stroke-width": 4, "stroke-linecap": "round",
      "stroke-dasharray": (v * c) + " " + c, transform: "rotate(-90 20 20)" }));
    var t = svg("text", { x: 20, y: 23.5, "text-anchor": "middle", class: "ring-text" });
    t.textContent = Math.round(v * 100) + "%";
    s.appendChild(t);
    return s;
  }

  // responses per week (or per day for 30 days), as rounded bars
  function trendChart(list) {
    var days = range === "all" ? Math.max(28, Math.ceil((Date.now() - Math.min.apply(null, list.map(function (r) { return r.t; }).concat([Date.now()]))) / 864e5) + 1) : Number(range);
    var step = days <= 31 ? 7 : days <= 120 ? 7 : 30;
    var n = Math.min(26, Math.ceil(days / step));
    var now = Date.now();
    var buckets = [];
    for (var i = n - 1; i >= 0; i--) {
      var end = now - i * step * 864e5, start = end - step * 864e5;
      buckets.push({ start: start, count: list.filter(function (r) { return r.t >= start && r.t < end; }).length });
    }
    var max = Math.max(1, Math.max.apply(null, buckets.map(function (b) { return b.count; })));
    var W = window.innerWidth >= 700 ? 680 : 320, H = 130, pad = 18, bw = (W - 8) / n;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + (H + pad), class: "trend", role: "img", "aria-label": "Responses over time" });
    [0.5, 1].forEach(function (f) {
      s.appendChild(svg("line", { x1: 0, x2: W, y1: H - f * (H - 16), y2: H - f * (H - 16), class: "grid" }));
    });
    buckets.forEach(function (b, i) {
      var h = b.count ? Math.max(6, b.count / max * (H - 16)) : 3;
      var x = 4 + i * bw + bw * 0.18, w = bw * 0.64;
      var last = i === n - 1;
      var rect = svg("rect", { x: x, y: H - h, width: w, height: h, rx: Math.min(6, w / 2), class: last ? "bar now" : "bar" });
      var title = svg("title", {});
      title.textContent = b.count + " responses, week of " + new Date(b.start).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      rect.appendChild(title);
      s.appendChild(rect);
      if (b.count && (last || b.count === max)) {
        var t = svg("text", { x: x + w / 2, y: H - h - 5, "text-anchor": "middle", class: "bar-val" });
        t.textContent = b.count;
        s.appendChild(t);
      }
      if (i === 0 || i === n - 1 || (n > 6 && i === Math.floor(n / 2))) {
        var l = svg("text", { x: x + w / 2, y: H + 14, "text-anchor": "middle", class: "axis" });
        l.textContent = new Date(b.start + step * 864e5).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        s.appendChild(l);
      }
    });
    return el("div", { class: "trend-wrap" }, [s]);
  }

  // ---------------- overview ----------------
  var HEARD_COLORS = ["var(--pink)", "var(--blue)", "var(--orange)", "var(--green)", "#8a7f92", "#c9c1ba"];

  function statCard(o) {
    var card = o.onClick ? el("button", { class: "stat " + (o.tone || ""), type: "button" }) : el("div", { class: "stat " + (o.tone || "") });
    card.appendChild(el("div", { class: "stat-top" }, [el("span", { class: "stat-icon", text: o.icon }), o.ring || el("span")]));
    card.appendChild(el("span", { class: "stat-label", text: o.label }));
    card.appendChild(el("span", { class: "stat-value" }, [document.createTextNode(o.value), el("small", { text: o.unit || "" })]));
    if (o.note) card.appendChild(el("span", { class: "stat-note " + (o.noteTone || ""), text: o.note }));
    if (o.onClick) card.addEventListener("click", o.onClick);
    return card;
  }

  function renderOverview() {
    var all = allResponses();
    var now = withinRange(all), before = withinRange(all, Number(range) || 0);
    var revNow = withinRange(cache.review || []);
    var stars = revNow.map(function (r) { return r.a.stars; }).filter(function (v) { return typeof v === "number"; });
    var avg = stars.length ? stars.reduce(function (a, b) { return a + b; }, 0) / stars.length : 0;
    var rec = revNow.map(function (r) { return r.a.recommend; }).filter(function (v) { return typeof v === "number"; });
    var nps = rec.length ? Math.round((rec.filter(function (v) { return v >= 9; }).length - rec.filter(function (v) { return v <= 6; }).length) / rec.length * 100) : null;
    var waiting = (cache.review || []).filter(function (r) { return r.st === "new"; }).length;

    var change = null;
    if (range !== "all") {
      if (before.length) change = Math.round((now.length - before.length) / before.length * 100);
      else if (now.length) change = 100;
    }

    var grid = $("stats");
    grid.textContent = "";
    grid.appendChild(statCard({
      icon: "✎", label: "Responses", value: String(now.length), unit: " " + (range === "all" ? "total" : "in " + range + " days"),
      note: change === null ? "All surveys" : (change >= 0 ? "▲ " : "▼ ") + Math.abs(change) + "% vs previous",
      noteTone: change === null ? "" : change >= 0 ? "up" : "down", tone: "pink"
    }));
    grid.appendChild(statCard({
      icon: "★", label: "Average rating", value: avg ? avg.toFixed(1) : "–", unit: " / 5",
      note: stars.length + (stars.length === 1 ? " review" : " reviews"), ring: ring(avg / 5, "#f5a623")
    }));
    grid.appendChild(statCard({
      icon: "♥", label: "Would recommend", value: nps === null ? "–" : (nps > 0 ? "+" : "") + nps, unit: nps === null ? "" : " score",
      note: nps === null ? "No answers yet" : (nps >= 50 ? "Excellent" : nps > 0 ? "Good" : "Needs attention"),
      noteTone: nps === null ? "" : nps > 0 ? "up" : "down",
      ring: ring(rec.length ? rec.filter(function (v) { return v >= 9; }).length / rec.length : 0, "var(--green-ink)")
    }));
    grid.appendChild(statCard({
      icon: "✓", label: "Reviews to approve", value: String(waiting), unit: "",
      note: waiting ? "Tap to review" : "All caught up", tone: waiting ? "dark" : "",
      onClick: function () { filter = "new"; renderReviews(); showTab("reviews"); }
    }));

    // trend
    var trend = $("trend");
    trend.textContent = "";
    $("trend-note").textContent = rangeLabel();
    if (!all.length) trend.appendChild(el("p", { class: "dash-empty", text: "No responses yet. Share your review link to get started." }));
    else trend.appendChild(trendChart(now.length || range === "all" ? now : all.slice(0, 0)));

    // how people found us (review survey's "heard" question)
    var heardBox = $("heard");
    heardBox.textContent = "";
    var heard = {};
    revNow.forEach(function (r) { if (r.a.heard) heard[r.a.heard] = (heard[r.a.heard] || 0) + 1; });
    var keys = Object.keys(heard).sort(function (a, b) { return heard[b] - heard[a]; });
    var total = keys.reduce(function (s, k) { return s + heard[k]; }, 0);
    $("heard-note").textContent = total ? total + " answers" : "";
    if (!total) heardBox.appendChild(el("p", { class: "dash-empty", text: "No answers yet for this time range." }));
    else {
      var bar = el("div", { class: "split-bar" });
      var legend = el("div", { class: "split-legend" });
      keys.forEach(function (k, i) {
        var pct = Math.round(heard[k] / total * 100);
        var seg = el("span", { title: k + ": " + pct + "%" });
        seg.style.flex = heard[k];
        seg.style.background = HEARD_COLORS[i % HEARD_COLORS.length];
        bar.appendChild(seg);
        var dot = el("i");
        dot.style.background = HEARD_COLORS[i % HEARD_COLORS.length];
        legend.appendChild(el("span", null, [dot, document.createTextNode(k + " "), el("b", { text: pct + "%" })]));
      });
      heardBox.appendChild(bar);
      heardBox.appendChild(legend);
    }

    // classes by rating
    var top = $("top-classes");
    top.textContent = "";
    var byClass = {};
    revNow.forEach(function (r) { if (r.a.class && r.a.stars) (byClass[r.a.class] = byClass[r.a.class] || []).push(r.a.stars); });
    var rows = Object.keys(byClass).map(function (c) {
      var v = byClass[c]; return { name: c, avg: v.reduce(function (a, b) { return a + b; }, 0) / v.length, n: v.length };
    }).sort(function (a, b) { return b.avg - a.avg || b.n - a.n; });
    if (!rows.length) top.appendChild(el("p", { class: "dash-empty", text: "No class reviews yet for this time range." }));
    rows.slice(0, 6).forEach(function (row) {
      var fill = el("span");
      fill.style.width = (row.avg / 5 * 100) + "%";
      top.appendChild(el("div", { class: "cls-row", "data-cat": S.categoryOf(row.name) }, [
        el("span", { class: "cls-name", text: row.name }),
        el("span", { class: "cls-bar" }, [fill]),
        el("span", { class: "cls-num", text: row.avg.toFixed(1) + " ★ · " + row.n })
      ]));
    });
  }

  // ---------------- sharing + one-time links ----------------
  var linkSurvey = null;
  function shareSurvey(s) {
    if (s.access !== "links") {
      if (navigator.share) navigator.share({ title: s.title, url: linkFor(s) }).catch(function () {});
      else copy(linkFor(s), "Link copied!");
      return;
    }
    linkSurvey = s;
    $("links-title").textContent = s.title;
    $("links-out").textContent = "";
    $("links-actions").hidden = true;
    $("links-count").textContent = "";
    $("links").showModal();
    api("/api/admin/links?survey=" + encodeURIComponent(s.id)).then(function (c) {
      $("links-count").textContent = c.open + " unused · " + c.used + " answered";
    }).catch(function () {});
  }
  var madeLinks = [];
  $("links-make").addEventListener("click", function () {
    var n = Number($("links-n").value) || 1;
    $("links-make").disabled = true;
    api("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ survey: linkSurvey.id, count: n }) })
      .then(function (b) {
        madeLinks = b.links;
        var out = $("links-out");
        out.textContent = "";
        b.links.forEach(function (l, i) {
          var row = el("div", { class: "link-row", title: l }, [el("span", { text: "Link " + (i + 1) + " · …" + l.slice(-6) })]);
          var c = el("button", { type: "button", class: "chip", text: "Copy" });
          c.addEventListener("click", function () { copy(l, "Link " + (i + 1) + " copied"); c.textContent = "Copied ✓"; });
          row.appendChild(c);
          out.appendChild(row);
        });
        $("links-actions").hidden = false;
        $("links-share").hidden = !(navigator.share && b.links.length === 1);
      })
      .catch(function (e) { msg(e.message); })
      .then(function () { $("links-make").disabled = false; });
  });
  $("links-copyall").addEventListener("click", function () { copy(madeLinks.join("\n"), madeLinks.length + " links copied"); });
  $("links-share").addEventListener("click", function () { navigator.share({ title: linkSurvey.title, url: madeLinks[0] }).catch(function () {}); });
  $("links-close").addEventListener("click", function () { $("links").close(); });
  $("links").addEventListener("click", function (e) { if (e.target === $("links")) $("links").close(); });

  // ---------------- templates ----------------
  var templates = [];     // saved templates (Sam can edit / add)
  function openTemplates() {
    var list = $("tpl-list");
    list.textContent = "";
    if (!templates.length) list.appendChild(el("p", { class: "dash-empty", text: "No templates yet. Make one below." }));
    templates.forEach(function (t) {
      var use = el("button", { type: "button", class: "tpl" }, [
        el("span", { class: "sv-icon " + (t.tone || "blue"), text: t.icon || "✎" }),
        el("span", { class: "tpl-text" }, [el("strong", { text: t.title }), el("span", { text: t.questions.length + (t.questions.length === 1 ? " question" : " questions") + (t.intro ? " · " + t.intro : "") })]),
        el("span", { class: "tpl-use", text: "Use" })
      ]);
      use.addEventListener("click", function () { $("templates").close(); openBuilder(null, t); });
      var edit = el("button", { type: "button", class: "tpl-edit", "aria-label": "Edit template " + t.title, text: "Edit" });
      edit.addEventListener("click", function () { $("templates").close(); openBuilder(t, null, "template"); });
      list.appendChild(el("div", { class: "tpl-row" }, [use, edit]));
    });
    $("templates").showModal();
  }
  $("tpl-new").addEventListener("click", function () { $("templates").close(); openBuilder(null, null, "template"); });
  $("tpl-close").addEventListener("click", function () { $("templates").close(); });
  $("templates").addEventListener("click", function (e) { if (e.target === $("templates")) $("templates").close(); });

  // ---------------- reviews ----------------
  $("rv-filter").addEventListener("click", function (e) {
    var b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.getAttribute("data-f");
    renderReviews();
  });

  function renderReviews() {
    var waiting = reviews.filter(function (r) { return r.st === "new"; }).length;
    $("badge").textContent = waiting ? String(waiting) : "";
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
      renderOverview();
      msg(change.status === "approved" ? "Approved. It's on the website now." : change.remove ? "Deleted." : "Saved.");
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
      var all = cache[s.id] || [];
      var inR = withinRange(all);
      var last = all[0];
      var card = el("article", { class: "sv-card" + (s.open ? "" : " is-closed") }, [
        el("div", { class: "sv-card-top" }, [
          el("span", { class: "sv-icon " + (s.kind === "review" ? "pink" : s.event ? "orange" : "blue"), text: s.kind === "review" ? "★" : s.event ? "◆" : "?" }),
          el("div", { class: "sv-card-text" }, [
            el("strong", { text: s.title }),
            el("span", { text: (s.kind === "review" ? "Class reviews" : whereText(s)) + " · " + (s.access === "links" ? "One-time links" : "Open link, once per phone") })
          ]),
          el("span", { class: "sv-pill " + (s.open ? "on" : ""), text: s.open ? "Open" : "Closed" })
        ]),
        el("div", { class: "sv-card-stats" }, [
          el("div", null, [el("b", { text: String(inR.length) }), el("span", { text: rangeLabel() })]),
          el("div", null, [el("b", { text: String(all.length) }), el("span", { text: "all time" })]),
          el("div", null, [el("b", { text: last ? S.formatDate(new Date(last.t).toISOString().slice(0, 10), { month: "short", day: "numeric" }) : "–" }), el("span", { text: "last answer" })])
        ])
      ]);
      var actions = el("div", { class: "sv-card-actions" });
      function btn(label, fn, cls) { var b = el("button", { type: "button", class: cls || "", text: label }); b.addEventListener("click", fn); actions.appendChild(b); }
      btn("Results", function () { openResults(s); }, "is-main");
      btn(s.access === "links" ? "Get links" : navigator.share ? "Share" : "Copy link", function () { shareSurvey(s); });
      btn("Edit", function () { openBuilder(s); });
      btn(s.open ? "Close" : "Open", function () { s.open = !s.open; saveSurveys(); });
      card.appendChild(actions);
      list.appendChild(card);
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
        review: reviewS ? { title: reviewS.title, intro: reviewS.intro, questions: reviewS.questions, access: reviewS.access } : null,
        templates: templates })
    }).then(function (body) {
      surveys = body.surveys;
      templates = body.templates || templates;
      surveys.forEach(function (x) { cache[x.id] = cache[x.id] || []; });
      renderSurveys();
      msg("Saved.");
    }).catch(function (e) { msg(e.message); throw e; });
  }

  // ---------------- results ----------------
  var resultsSurvey = null;
  $("res-close").addEventListener("click", function () { $("results").close(); });
  $("results").addEventListener("click", function (e) { if (e.target === $("results")) $("results").close(); });

  function openResults(s) {
    resultsSurvey = s;
    $("res-title").textContent = s.title;
    $("res-where").textContent = (s.kind === "review" ? "Class reviews" : whereText(s)) + " · " + rangeLabel();
    $("res-body").textContent = "Loading…";
    $("results").showModal();
    var load = cache[s.id] ? Promise.resolve(cache[s.id]) : api("/api/admin/responses?survey=" + encodeURIComponent(s.id)).then(function (b) { cache[s.id] = b.responses; return b.responses; });
    load.then(drawResults).catch(function (e) { $("res-body").textContent = e.message; });
  }

  function inRange() { return withinRange(cache[resultsSurvey.id] || []); }

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
    body.appendChild(trendChart(list));

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
  $("res-csv").addEventListener("click", exportCsv);
  function exportCsv() {
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
  }

  // ---------------- survey builder ----------------
  var draft = null;
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "new") openBuilder(null);
    if (act === "templates") openTemplates();
    if (act === "share") shareSurvey(surveys[0]);
    if (act === "export") { resultsSurvey = surveys[0]; exportCsv(); }
    if (act === "review-results") openResults(surveys[0]);
  });
  $("b-cancel").addEventListener("click", function () { $("builder").close(); });
  $("builder").addEventListener("click", function (e) { if (e.target === $("builder")) $("builder").close(); });

  var builderMode = "survey";   // "survey" or "template"
  function openBuilder(s, template, mode) {
    builderMode = mode || "survey";
    var base = { id: "", kind: "custom", title: "", intro: "", open: true, event: "", access: "links", questions: [{ type: "choice", label: "", options: [], required: true }] };
    if (builderMode === "template") draft = Object.assign(base, s ? JSON.parse(JSON.stringify(s)) : {});
    else if (s) draft = JSON.parse(JSON.stringify(s));
    else if (template) { var t = JSON.parse(JSON.stringify(template)); draft = Object.assign(base, { title: t.title, intro: t.intro, questions: t.questions }); }
    else draft = base;
    if (!draft.access) draft.access = "anyone";
    var editingSurvey = !!s && builderMode === "survey";
    draft.questions.forEach(function (q) {
      if (q.type === "text" && q.long) q.type = "long";
      if (!editingSurvey) delete q.id;   // a fresh copy gets new question ids
    });
    var isTpl = builderMode === "template";
    $("b-title").textContent = isTpl ? (s ? "Edit template" : "New template") : s ? "Edit survey" : "New survey";
    $("b-submit").textContent = isTpl ? "Save template" : "Publish";
    $("b-access-wrap").hidden = isTpl;
    drawAccess();
    $("b-name").value = draft.title;
    $("b-intro").value = draft.intro || "";
    $("b-delete").hidden = !s || draft.kind === "review";
    $("b-where-wrap").hidden = draft.kind === "review" || isTpl;
    $("b-review-note").hidden = draft.kind !== "review";
    drawWhere();
    $("b-error").textContent = "";
    drawQuestions();
    $("builder").showModal();
  }

  // Who can answer: one-time links (recommended) or anyone, once per phone
  function drawAccess() {
    var holder = $("b-access");
    holder.textContent = "";
    [["links", "One-time links (recommended)"], ["anyone", "Anyone with the link"]].forEach(function (o) {
      var b = el("button", { type: "button", class: "chip", "aria-pressed": String(draft.access === o[0]), text: o[1] });
      b.addEventListener("click", function () { draft.access = o[0]; drawAccess(); if (draft.kind !== "review") drawWhere(); });
      holder.appendChild(b);
    });
    $("b-access-hint").textContent = draft.access === "links"
      ? "You send each person their own link. Each link works once, so nobody can answer twice."
      : "One shared link. Each phone can answer once" + (draft.kind === "review" ? ", and \u201cLeave a review\u201d buttons show on class cards." : ".");
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
      ? (draft.access === "links" ? "Linked to this event in your results. (One-time-link surveys don't show a public button; send links to attendees.)" : "A button to this survey shows on that event's card, and for 2 weeks after the event.")
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
    if (!draft.title) { $("b-error").textContent = builderMode === "template" ? "Give the template a name." : "Give the survey a title."; return; }
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
    out.access = draft.access || "anyone";
    var bad = out.questions.filter(function (q) { return (q.type === "choice" || q.type === "multi") && q.options.length < 2; })[0];
    if (bad) { $("b-error").textContent = "“" + bad.label + "” needs at least 2 options (one per line)."; return; }
    if (builderMode === "template") {
      var tpl = { id: draft.id || "", icon: draft.icon || "✎", tone: draft.tone || ["pink", "blue", "orange", "green"][templates.length % 4], title: out.title, intro: out.intro, questions: out.questions.map(function (q) { delete q.id; return q; }) };
      var ti = templates.findIndex(function (t) { return draft.id && t.id === draft.id; });
      var beforeT = templates.slice();
      if (ti === -1) templates.push(tpl); else templates[ti] = tpl;
      saveSurveys().then(function () { $("builder").close(); msg(ti === -1 ? "Template saved." : "Template updated."); openTemplates(); })
        .catch(function (err) { templates = beforeT; $("b-error").textContent = err.message; });
      return;
    }
    var i = surveys.findIndex(function (s) { return draft.id && s.id === draft.id; });
    var before = surveys.slice();
    if (i === -1) surveys.push(out); else surveys[i] = out;
    saveSurveys().then(function () {
      $("builder").close();
      msg(i === -1 ? (out.access === "links" ? "Survey created. Tap Get links to send it." : "Survey created. Tap Share to send it.") : "Survey saved.");
    }).catch(function (err) { surveys = before; $("b-error").textContent = err.message; });
  });

  $("b-delete").addEventListener("click", function () {
    if (builderMode === "template") {
      if (!confirm("Delete this template?")) return;
      var beforeT = templates.slice();
      templates = templates.filter(function (t) { return t.id !== draft.id; });
      saveSurveys().then(function () { $("builder").close(); msg("Template deleted."); openTemplates(); }).catch(function () { templates = beforeT; });
      return;
    }
    if (!confirm("Delete this survey? Its link will stop working.")) return;
    var before = surveys.slice();
    surveys = surveys.filter(function (s) { return s.id !== draft.id; });
    saveSurveys().then(function () { $("builder").close(); msg("Survey deleted. Its past answers are kept in storage."); })
      .catch(function () { surveys = before; });
  });
})();
