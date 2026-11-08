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

  // Morning (before 12), Afternoon (12-5 PM), Evening (5 PM on)
  var PERIODS = {
    morning: { label: "Morning", icon: "sun" },
    afternoon: { label: "Afternoon", icon: "sun" },
    evening: { label: "Evening", icon: "moon" }
  };
  function periodOf(hhmm) {
    var h = parseInt(hhmm, 10);
    return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
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
    var classes = (data.classes || []).map(function (c) {
      return { day: c.day, time: c.time, name: c.name, cat: S.categoryOf(c.name) };
    });

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

    var today = S.todayKey();
    var days = S.DAYS.filter(function (d) {
      return classes.some(function (c) { return c.day === d.key; });
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
      var lastPeriod = null;
      S.sortClasses(classes.filter(function (c) { return c.day === d.key; })).forEach(function (c) {
        var period = periodOf(c.time);
        if (period !== lastPeriod) {
          ul.appendChild(el("li", { class: "period-head", "data-period-head": period }, [periodLabel(period)]));
          lastPeriod = period;
        }
        ul.appendChild(el("li", { "data-cat": c.cat, "data-item": "", "data-period": period }, [
          el("time", { text: S.formatTime(c.time) }),
          el("span", { class: "class-name", text: c.name })
        ]));
      });
      listEl.appendChild(el("section", { class: "day-card" + (isToday ? " is-today" : ""), "data-day": d.key }, [h, ul]));
    });

    // ---- phone day tabs: one day at a time, opens on today (or the next day with classes) ----
    var order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    var todayIdx = order.indexOf(today);
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
        el("span", { class: "day-tab-date", text: String(date.getDate()) })
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
        // Group by time of day, then by start time: "Morning · Mon & Wed · 10:00 AM"
        var byPeriod = {};
        g.times.forEach(function (c) {
          var p = periodOf(c.time);
          byPeriod[p] = byPeriod[p] || {};
          (byPeriod[p][c.time] = byPeriod[p][c.time] || []).push(c.day);
        });
        var slots = el("ul", { class: "class-slots" });
        ["morning", "afternoon", "evening"].forEach(function (p) {
          if (!byPeriod[p]) return;
          Object.keys(byPeriod[p]).sort().forEach(function (time) {
            var dayKeys = byPeriod[p][time].sort(function (a, b) { return dayOrder.indexOf(a) - dayOrder.indexOf(b); });
            var names = dayKeys.map(function (k) { return S.DAYS[dayOrder.indexOf(k)].short; });
            var hasToday = dayKeys.indexOf(today) !== -1;
            slots.appendChild(el("li", { class: "slot-row" + (hasToday ? " has-today" : "") }, [
              periodLabel(p),
              el("span", { class: "slot-days", text: joinDays(names) }),
              el("span", { class: "slot-time", text: S.formatTime(time) })
            ]));
          });
        });
        var head = [el("h3", { class: "class-name", text: g.name })];
        if (g.times.length === 1) head.push(el("span", { class: "class-freq", text: "Once a week" }));
        classListEl.appendChild(el("article", { class: "class-row", "data-cat": g.cat }, [
          el("div", { class: "class-row-head" }, head),
          slots
        ]));
      });

    // ---- view switch (phones/tablets); remember the visitor's choice ----
    function setView(view) {
      var byClass = view === "class";
      toggleEl.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === view));
      });
      classListEl.hidden = !byClass;
      document.body.classList.toggle("view-by-class", byClass);
      try { localStorage.setItem("sps-schedule-view", view); } catch (e) { /* private mode */ }
    }
    toggleEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (b) setView(b.getAttribute("data-view"));
    });
    var saved = null;
    try { saved = localStorage.getItem("sps-schedule-view"); } catch (e) { /* ignore */ }
    setView(saved === "class" ? "class" : "day");

    // ---- desktop grid (rows = time slots, columns = days) ----
    var times = Array.from(new Set(classes.map(function (c) { return c.time; }))).sort();
    var colgroup = el("colgroup", null, [el("col", { class: "time" })]);
    var headRow = el("tr", null, [el("th", { scope: "col", text: "Time" })]);
    days.forEach(function (d) {
      colgroup.appendChild(el("col"));
      headRow.appendChild(el("th", { scope: "col", class: d.key === today ? "is-today" : "", text: d.short }));
    });
    var tbody = el("tbody");
    times.forEach(function (t) {
      var tr = el("tr", { "data-row": "" }, [el("th", { scope: "row", text: S.formatTime(t) })]);
      days.forEach(function (d) {
        var td = el("td");
        classes.filter(function (c) { return c.day === d.key && c.time === t; }).forEach(function (c) {
          td.appendChild(el("span", { class: "slot", "data-cat": c.cat, "data-item": "", text: c.name }));
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
