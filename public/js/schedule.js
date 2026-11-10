// Schedule page: weekly grid on desktop, day-by-day list on phones.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;

  var monthEl = document.getElementById("sched-month");
  var noteEl = document.getElementById("sched-note-text");
  var listEl = document.getElementById("day-list");
  var gridEl = document.getElementById("week-grid");
  var classListEl = document.getElementById("class-list");
  var toggleEl = document.getElementById("view-toggle");
  var filtersEl = document.getElementById("filters");
  var updatedEl = document.getElementById("updated");

  var active = "all";

  // Two groups: Daytime (before 5 PM) and Evening (5 PM on)
  var PERIODS = {
    daytime: { label: "Daytime", icon: "sun" },
    evening: { label: "Evening", icon: "moon" }
  };
  function periodOf(hhmm) {
    return parseInt(hhmm, 10) < 17 ? "daytime" : "evening";
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  var ICON_PATHS = {
    sun: ["M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z", "M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"],
    moon: ["M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"]
  };
  function periodIcon(name) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "period-icon");
    ICON_PATHS[name].forEach(function (d) {
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    return svg;
  }
  function periodLabel(key) {
    return el("span", { class: "period period-" + key }, [periodIcon(PERIODS[key].icon), document.createTextNode(PERIODS[key].label)]);
  }
  // ["Mon", "Wed"] -> "Mon & Wed"; ["Mon", "Wed", "Fri"] -> "Mon, Wed & Fri"
  function joinDays(list) {
    if (list.length < 2) return list.join("");
    return list.slice(0, -1).join(", ") + " & " + list[list.length - 1];
  }

  S.loadSchedule().then(render).catch(function () {
    listEl.appendChild(el("p", { class: "empty", text: "We couldn't load the schedule. Text us and we'll send it over." }));
  });

  function render(data) {
    // The next schedule shows from early registration on: /schedule?m=next
    var wantNext = new URLSearchParams(location.search).get("m") === "next";
    // "How to register" only on the coming-up schedule; this month's sign-ups are closed.
    var regBox = document.querySelector(".sched-note");
    if (regBox) regBox.hidden = !(wantNext && data.next);
    if (data.next) {
      var cur = data.month.split(" ")[0], nxt = data.next.month.split(" ")[0];
      var tabs = document.getElementById("month-tabs");
      [[cur + " · now", "/schedule", !wantNext], ["Coming up: " + nxt, "/schedule?m=next", wantNext]].forEach(function (t) {
        tabs.appendChild(el("a", { href: t[1], "aria-current": t[2] ? "page" : "false", text: t[0] }));
      });
      tabs.hidden = false;
      var ann = S.nextAnnouncement(data.next);
      var signup = document.querySelector(".sched-note a");
      if (wantNext) {
        // Make it impossible to mistake for this month's schedule.
        var start = S.formatDate(data.next.start, { month: "long", day: "numeric" });
        var label = el("p", { class: "upcoming-label" }, [
          el("strong", { text: "Upcoming schedule · starts " + start + ". " }),
          document.createTextNode("For this month's classes, see "),
          el("a", { href: "/schedule", text: cur }), document.createTextNode(".")
        ]);
        monthEl.parentNode.insertBefore(label, monthEl);
        // "How to register" with a tappable Book now (texts Sam about this month)
        var book = el("a", { href: S.smsLink("Hi! I'd like to sign up for " + nxt + " classes." + (data.next.phase === "early" ? " I'm a current student." : "")), text: "Book now" });
        var openDay = S.formatDate(data.next.open, { month: "short", day: "numeric" });
        noteEl.textContent = "";
        if (data.next.phase === "early") {
          noteEl.appendChild(document.createTextNode("Current students, tap "));
          noteEl.appendChild(book);
          noteEl.appendChild(document.createTextNode(" to save your spot. General registration opens " + openDay + "."));
        } else {
          noteEl.appendChild(document.createTextNode("Tap "));
          noteEl.appendChild(book);
          noteEl.appendChild(document.createTextNode(" and send us your name and class."));
        }
        if (signup) {
          signup.href = S.smsLink("Hi! I'd like to sign up for " + nxt + " classes." + (data.next.phase === "early" ? " I'm a current student." : ""));
          signup.textContent = data.next.phase === "early" ? "Current students: text to sign up" : "Text to sign up for " + nxt;
        }
        data = Object.assign({}, data, { month: data.next.month, classes: data.next.classes, note: "", isUpcoming: true });
      } else {
        var box = el("a", { class: "next-banner", href: "/schedule?m=next" }, [
          el("span", { class: "nb-eyebrow", text: "Coming up" }),
          el("span", { class: "nb-body" }, [el("strong", { text: ann.title }), el("span", { class: "nb-text", text: ann.text })]),
          el("span", { class: "nb-link", text: "See " + nxt + " →" })
        ]);
        tabs.parentNode.insertBefore(box, tabs.nextSibling);
      }
    }
    // Every class belongs to a monthly package (its set days + price).
    var pk = S.packagesOf(data.classes, data);
    var classes = (data.classes || []).map(function (c) {
      return { day: c.day, time: c.time, name: c.name, cat: S.categoryOf(c.name), pkg: pk.byClass(c) };
    });
    var closedDays = data.closed || [];
    function dayNames(keys) { return joinDays(keys.map(function (k) { return S.DAYS.filter(function (d) { return d.key === k; })[0].short; })); }
    // "$100/mo" or "$85/mo · 1.5 hrs" or "$50/mo (was $100) · Black Friday"
    function priceText(p) {
      var t = p.onSale ? "$" + p.sale.price + "/mo (was $" + p.monthly + ")" : "$" + p.monthly + "/mo";
      var len = S.lengthText(p.len);
      if (len) t += " · " + len;
      if (p.onSale && p.sale.label) t += " · " + p.sale.label;
      return t;
    }
    function pkgMeta(p) {
      var kids = [document.createTextNode(dayNames(p.days) + " · ")];
      if (p.onSale) kids.push(el("span", { class: "sale-tag", text: "Sale" }));
      kids.push(document.createTextNode((p.onSale ? " " : "") + priceText(p)));
      return el("span", { class: "pkg-meta" + (p.custom || p.onSale ? " is-special" : "") }, kids);
    }
    // one-line explainer above the schedule
    if (!document.getElementById("pkg-explain")) {
      var explain = el("p", { class: "pkg-explain", id: "pkg-explain" }, [
        el("strong", { text: "Each class is a monthly package. " }),
        document.createTextNode("You sign up for all of its days, like Mon & Wed.")
      ]);
      filtersEl.parentNode.insertBefore(explain, filtersEl);
    }

    if (data.month) {
      monthEl.textContent = data.month;
      document.title = data.month + " schedule · Sam's Personal Studio";
    }
    if (data.note) noteEl.textContent = data.note;
    if (data.updatedAt) {
      var d = new Date(data.updatedAt);
      if (!isNaN(d)) updatedEl.textContent = "Last updated " + d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    }

    if (!classes.length) {
      listEl.appendChild(el("p", { class: "empty", text: "The new schedule is coming soon. Text us for this week's classes." }));
      return;
    }

    // An upcoming schedule has no "today" and no dates on the day buttons.
    var upcoming = wantNext && !!data.isUpcoming;
    var today = upcoming ? "" : S.todayKey();
    var days = S.DAYS.filter(function (d) {
      return closedDays.indexOf(d.key) !== -1 || classes.some(function (c) { return c.day === d.key; });
    });

    // ---- filters: only show categories that are actually on the schedule ----
    var cats = S.CATEGORIES.filter(function (cat) {
      return classes.some(function (c) { return c.cat === cat.key; });
    });
    var allBtn = el("button", { type: "button", class: "filter", "aria-pressed": "true", "data-filter": "all", text: "All classes" });
    filtersEl.appendChild(allBtn);
    cats.forEach(function (cat) {
      filtersEl.appendChild(el("button", {
        type: "button", class: "filter", "aria-pressed": "false", "data-filter": cat.key, "data-cat": cat.key
      }, [el("span", { class: "dot" }), document.createTextNode(cat.label)]));
    });
    filtersEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      active = btn.getAttribute("data-filter");
      filtersEl.querySelectorAll("[data-filter]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      applyFilter();
    });

    // ---- phone list ----
    days.forEach(function (d) {
      var isToday = d.key === today;
      var h = el("h2", null, [el("span", { text: d.long })]);
      if (isToday) h.appendChild(el("span", { class: "today-tag", text: "Today" }));
      var ul = el("ul");
      if (closedDays.indexOf(d.key) !== -1 && !classes.some(function (c) { return c.day === d.key; })) {
        ul.appendChild(el("li", { class: "closed-row", text: "Closed this month" }));
      }
      var lastPeriod = null;
      S.sortClasses(classes.filter(function (c) { return c.day === d.key; })).forEach(function (c) {
        var period = periodOf(c.time);
        if (period !== lastPeriod) {
          ul.appendChild(el("li", { class: "period-head", "data-period-head": period }, [periodLabel(period)]));
          lastPeriod = period;
        }
        ul.appendChild(el("li", { "data-cat": c.cat, "data-item": "", "data-period": period }, [
          el("time", { text: S.formatTime(c.time) }),
          el("span", { class: "class-name-wrap" }, [el("span", { class: "class-name", text: c.name }), pkgMeta(c.pkg)])
        ]));
      });
      listEl.appendChild(el("section", { class: "day-card" + (isToday ? " is-today" : ""), "data-day": d.key }, [h, ul]));
    });

    // ---- phone day tabs: one day at a time, opens on today (or the next day with classes) ----
    var order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    var todayIdx = today ? order.indexOf(today) : 1; // upcoming: start on Monday
    var tabs = el("div", { class: "day-tabs", role: "tablist", "aria-label": "Pick a day" });
    var start = null;
    for (var i = 0; i < 7 && !start; i++) {
      var key = order[(todayIdx + i) % 7];
      if (days.some(function (d) { return d.key === key; })) start = key;
    }
    days.forEach(function (d) {
      // date of this weekday's next class, e.g. "9"
      var ahead = (order.indexOf(d.key) - todayIdx + 7) % 7;
      var date = new Date();
      date.setDate(date.getDate() + ahead);
      var tab = el("button", {
        type: "button", role: "tab", class: "day-tab", "data-day": d.key,
        "aria-selected": String(d.key === start), "aria-label": d.long
      }, [
        el("span", { class: "day-tab-name", text: d.key === today ? "Today" : d.short }),
        upcoming ? null : el("span", { class: "day-tab-date", text: String(date.getDate()) })
      ]);
      tabs.appendChild(tab);
    });
    listEl.parentNode.insertBefore(tabs, listEl);

    function showDay(key) {
      tabs.querySelectorAll(".day-tab").forEach(function (t) {
        var on = t.getAttribute("data-day") === key;
        t.setAttribute("aria-selected", String(on));
        if (on) tabs.scrollLeft = t.offsetLeft - tabs.clientWidth / 2 + t.offsetWidth / 2;
      });
      listEl.querySelectorAll(".day-card").forEach(function (card) {
        card.classList.toggle("is-active", card.getAttribute("data-day") === key);
      });
    }
    tabs.addEventListener("click", function (e) {
      var t = e.target.closest(".day-tab");
      if (t) showDay(t.getAttribute("data-day"));
    });
    showDay(start);

    // ---- "By class": each class once, with every day/time it runs ----
    var catOrder = S.CATEGORIES.map(function (c) { return c.key; });
    var dayOrder = S.DAYS.map(function (d) { return d.key; });
    var groups = {};
    classes.forEach(function (c) {
      var key = c.name.toLowerCase();
      if (!groups[key]) groups[key] = { name: c.name, cat: c.cat, times: [] };
      groups[key].times.push(c);
    });
    Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) {
        return catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.name.localeCompare(b.name);
      })
      .forEach(function (g) {
        // Daytime | Evening columns; one entry per package ("Mon & Wed · 10:00 AM · $100/mo")
        var seen = [];
        g.times.forEach(function (c) { if (seen.indexOf(c.pkg) === -1) seen.push(c.pkg); });
        var cols = el("div", { class: "slot-cols" });
        ["daytime", "evening"].forEach(function (p) {
          var mine = seen.filter(function (x) { return periodOf(x.time) === p; }).sort(function (a, b) { return a.time < b.time ? -1 : 1; });
          if (!mine.length) return;
          var col = el("div", { class: "slot-col" }, [periodLabel(p)]);
          mine.forEach(function (x) {
            var hasToday = x.days.indexOf(today) !== -1;
            var when = S.formatTime(x.time) + (x.len !== 60 ? "–" + S.formatTime(x.end) : "");
            col.appendChild(el("div", { class: "slot-entry" + (hasToday ? " has-today" : "") }, [
              el("strong", { text: dayNames(x.days) }),
              el("span", { text: when + (hasToday ? " · today" : "") }),
              el("span", { class: "slot-price" + (x.custom || x.onSale ? " is-special" : ""), text: priceText(x) })
            ]));
          });
          cols.appendChild(col);
        });
        var head = [el("span", { class: "class-dot" }), el("h3", { text: g.name })];

        classListEl.appendChild(el("article", { class: "class-row", "data-cat": g.cat }, [
          el("div", { class: "class-row-head" }, head),
          cols
        ]));
      });

    // ---- view switch (phones/tablets); remember the visitor's choice ----
    // Three views: list by day, list by class, and the weekly grid (like the flyer).
    function setView(view) {
      toggleEl.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === view));
      });
      classListEl.hidden = view !== "class";
      document.body.classList.toggle("view-by-class", view === "class");
      document.body.classList.toggle("view-grid", view === "grid");
      document.body.classList.toggle("view-day", view === "day");
      try { localStorage.setItem("sps-schedule-view", view); } catch (e) { /* private mode */ }
    }
    toggleEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (b) setView(b.getAttribute("data-view"));
    });
    var saved = null;
    try { saved = localStorage.getItem("sps-schedule-view"); } catch (e) { /* ignore */ }
    // phones open on "By day", computers on the weekly grid
    setView(["day", "class", "grid"].indexOf(saved) !== -1 ? saved : (window.innerWidth >= 960 ? "grid" : "day"));

    // ---- desktop grid (rows = time slots, columns = days) ----
    var times = Array.from(new Set(classes.map(function (c) { return c.time; }))).sort();
    var colgroup = el("colgroup", null, [el("col", { class: "time" })]);
    var headRow = el("tr", null, [el("th", { scope: "col", text: "Time" })]);
    days.forEach(function (d) {
      colgroup.appendChild(el("col", { class: closedDays.indexOf(d.key) !== -1 ? "is-closed" : "" }));
      headRow.appendChild(el("th", { scope: "col", class: d.key === today ? "is-today" : "", text: d.short }));
    });
    var tbody = el("tbody");
    times.forEach(function (t) {
      var tr = el("tr", { "data-row": "" }, [el("th", { scope: "row", text: S.formatTime(t) })]);
      days.forEach(function (d) {
        var td = el("td");
        var here = classes.filter(function (c) { return c.day === d.key && c.time === t; });
        if (!here.length && closedDays.indexOf(d.key) !== -1) { td.className = "closed-cell"; td.textContent = "Closed"; }
        here.forEach(function (c) {
          var sub = [el("span", { class: "slot-days", text: c.pkg.days.length > 1 ? dayNames(c.pkg.days) : "Once a week" })];
          if (c.pkg.custom || c.pkg.onSale) sub.push(el("span", { class: "slot-special", text: priceText(c.pkg) }));
          td.appendChild(el("span", { class: "slot", "data-cat": c.cat, "data-item": "" }, [el("span", { class: "slot-name", text: c.name })].concat(sub)));
        });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    var caption = el("caption", { class: "sr-only", text: (data.month || "Monthly") + " class schedule" });
    gridEl.appendChild(el("table", null, [caption, colgroup, el("thead", null, [headRow]), tbody]));
  }

  function applyFilter() {
    document.querySelectorAll("[data-item]").forEach(function (item) {
      var show = active === "all" || item.getAttribute("data-cat") === active;
      item.classList.toggle("is-hidden", !show);
    });
    // hide day cards / grid rows that end up empty
    listEl.querySelectorAll("[data-period-head]").forEach(function (head) {
      var p = head.getAttribute("data-period-head");
      var any = head.parentNode.querySelector('[data-period="' + p + '"]:not(.is-hidden)');
      head.classList.toggle("is-hidden", !any);
    });
    listEl.querySelectorAll(".day-card").forEach(function (card) {
      card.classList.toggle("is-hidden", !card.querySelector("[data-item]:not(.is-hidden)"));
    });
    gridEl.querySelectorAll("[data-row]").forEach(function (row) {
      row.classList.toggle("is-hidden", !row.querySelector("[data-item]:not(.is-hidden)"));
    });
  }
})();
