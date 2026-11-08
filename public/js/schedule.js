// Schedule page: weekly grid on desktop, day-by-day list on phones.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;

  var monthEl = document.getElementById("sched-month");
  var noteEl = document.getElementById("sched-note-text");
  var listEl = document.getElementById("day-list");
  var gridEl = document.getElementById("week-grid");
  var filtersEl = document.getElementById("filters");
  var updatedEl = document.getElementById("updated");

  var active = "all";

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
      S.sortClasses(classes.filter(function (c) { return c.day === d.key; })).forEach(function (c) {
        ul.appendChild(el("li", { "data-cat": c.cat, "data-item": "" }, [
          el("time", { text: S.formatTime(c.time) }),
          el("span", { class: "class-name", text: c.name })
        ]));
      });
      listEl.appendChild(el("section", { class: "day-card" + (isToday ? " is-today" : ""), "data-day": d.key }, [h, ul]));
    });

    // Put today's card first on phones so people see what's on right now.
    var todayCard = listEl.querySelector('[data-day="' + today + '"]');
    if (todayCard) listEl.insertBefore(todayCard, listEl.firstChild);

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
    listEl.querySelectorAll(".day-card").forEach(function (card) {
      card.classList.toggle("is-hidden", !card.querySelector("[data-item]:not(.is-hidden)"));
    });
    gridEl.querySelectorAll("[data-row]").forEach(function (row) {
      row.classList.toggle("is-hidden", !row.querySelector("[data-item]:not(.is-hidden)"));
    });
  }
})();
