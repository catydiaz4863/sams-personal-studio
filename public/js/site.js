// Shared helpers for every page. No build step, no framework.
(function () {
  "use strict";

  // ---- mobile menu ----
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Menu";
    });
  }

  // ---- schedule helpers ----
  var DAYS = [
    { key: "mon", short: "Mon", long: "Monday" },
    { key: "tue", short: "Tue", long: "Tuesday" },
    { key: "wed", short: "Wed", long: "Wednesday" },
    { key: "thu", short: "Thu", long: "Thursday" },
    { key: "fri", short: "Fri", long: "Friday" },
    { key: "sat", short: "Sat", long: "Saturday" },
    { key: "sun", short: "Sun", long: "Sunday" }
  ];

  var CATEGORIES = [
    { key: "pole", label: "Pole" },
    { key: "spin", label: "Spin pole" },
    { key: "exotic", label: "Exotic & flow" },
    { key: "belly", label: "Belly dance" },
    { key: "stretch", label: "Stretch & conditioning" }
  ];

  // Color-code a class from its name so the owner never has to pick a color.
  function categoryOf(name) {
    var n = String(name || "").toLowerCase();
    if (n.indexOf("belly") !== -1) return "belly";
    if (n.indexOf("stretch") !== -1 || n.indexOf("flex") !== -1 || n.indexOf("condition") !== -1) return "stretch";
    if (n.indexOf("spin") !== -1) return "spin";
    if (/exotic|heel|chair|floor|polesque|sensual|lap/.test(n)) return "exotic";
    return "pole";
  }

  // "17:30" -> "5:30 PM"
  function formatTime(hhmm) {
    var parts = String(hhmm).split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] || "00";
    if (isNaN(h)) return hhmm;
    var suffix = h >= 12 ? "PM" : "AM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + m + " " + suffix;
  }

  function todayKey() {
    // getDay(): 0 = Sunday
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
  }

  function sortClasses(list) {
    return list.slice().sort(function (a, b) {
      return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    });
  }

  // Live schedule comes from the API; if that isn't available (plain static
  // hosting, local file preview) fall back to the bundled JSON file.
  function loadSchedule() {
    return fetch("/api/schedule", { cache: "no-store" })
      .then(function (r) {
        var type = r.headers.get("content-type") || "";
        if (!r.ok || type.indexOf("json") === -1) throw new Error("no api");
        return r.json();
      })
      .catch(function () {
        return fetch("/data/schedule.json", { cache: "no-store" }).then(function (r) {
          return r.json();
        });
      });
  }

  // Tiny DOM builder. Uses textContent everywhere so schedule text can never
  // inject HTML into the page.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") node.textContent = attrs[k];
        else if (k === "class") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  // ---- prices (Sam edits these on the edit page) ----
  var DEFAULT_PRICES = { twice: 100, once: 70, registration: 30 };
  function pricesOf(data) {
    var p = (data && data.prices) || {};
    return {
      twice: p.twice != null ? p.twice : DEFAULT_PRICES.twice,
      once: p.once != null ? p.once : DEFAULT_PRICES.once,
      registration: p.registration != null ? p.registration : DEFAULT_PRICES.registration
    };
  }
  // Fill every <span data-price="twice|once|registration"> on the page.
  function applyPrices(data) {
    var prices = pricesOf(data);
    document.querySelectorAll("[data-price]").forEach(function (node) {
      var v = prices[node.getAttribute("data-price")];
      if (v != null) node.textContent = "$" + v;
    });
  }

  // ---- events ----
  var EVENT_TYPES = [
    { key: "workshop", label: "Workshop", cat: "pole" },
    { key: "recital", label: "Recital / show", cat: "spin" },
    { key: "dropin", label: "Drop-in class", cat: "exotic" },
    { key: "party", label: "Party", cat: "belly" },
    { key: "other", label: "Event", cat: "stretch" }
  ];
  function eventType(key) {
    return EVENT_TYPES.filter(function (t) { return t.key === key; })[0] || EVENT_TYPES[4];
  }
  function localDateKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // Events from today on, soonest first.
  function upcomingEvents(data) {
    var today = localDateKey();
    return ((data && data.events) || []).filter(function (e) { return e.date >= today; })
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
  }
  // "2026-12-05" -> Date at local noon (avoids timezone day shifts)
  function parseDate(ymd) { var p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function formatDate(ymd, opts) {
    return parseDate(ymd).toLocaleDateString("en-US", opts || { weekday: "long", month: "long", day: "numeric" });
  }
  // Text-message link to the studio with a message already written.
  var STUDIO_PHONE = "+19565338273";
  function smsLink(message) {
    return "sms:" + STUDIO_PHONE + "?&body=" + encodeURIComponent(message);
  }

  // "Coming up" text for the next schedule (current students first, then everyone)
  function nextAnnouncement(next) {
    var name = next.month.split(" ")[0];
    var d = function (ymd) { return parseDate(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
    if (next.phase === "early") return {
      title: name + " schedule is out",
      text: "Current students can register now · general registration opens " + d(next.open)
    };
    return { title: name + " registration is open", text: "Open to everyone · starts " + d(next.start) };
  }

  // ---- packages: each class is a monthly package of set days ----
  // Rows with the same pkg id belong together; older rows group by name + time.
  function addMinutes(hhmm, mins) {
    var p = hhmm.split(":"), t = (+p[0]) * 60 + (+p[1]) + mins;
    return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }
  function lengthText(len) {
    if (!len || len === 60) return "";
    var h = len / 60;
    return (h % 1 === 0 ? h : h.toFixed(1)) + " hrs";
  }
  function saleActive(sale) {
    return !!(sale && (!sale.until || sale.until >= localDateKey()));
  }
  function packagesOf(classes, data) {
    var prices = pricesOf(data);
    var order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    var map = {}, list = [];
    (classes || []).forEach(function (c) {
      var key = c.pkg ? "p:" + c.pkg : c.name + "|" + c.time;
      if (!map[key]) {
        map[key] = { key: key, name: c.name, time: c.time, len: c.len || 60, price: c.price, sale: c.sale, days: [], cat: categoryOf(c.name) };
        list.push(map[key]);
      }
      if (map[key].days.indexOf(c.day) === -1) map[key].days.push(c.day);
    });
    list.forEach(function (p) {
      p.days.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      p.standard = p.days.length >= 2 ? prices.twice : prices.once;
      p.monthly = p.price != null ? p.price : p.standard;
      p.custom = p.price != null || (p.len && p.len !== 60);
      p.onSale = saleActive(p.sale);
      p.end = addMinutes(p.time, p.len || 60);
    });
    return { list: list, byClass: function (c) { return map[c.pkg ? "p:" + c.pkg : c.name + "|" + c.time]; } };
  }

  window.SPS = {
    packagesOf: packagesOf,
    lengthText: lengthText,
    saleActive: saleActive,
    addMinutes: addMinutes,
    nextAnnouncement: nextAnnouncement,
    EVENT_TYPES: EVENT_TYPES,
    eventType: eventType,
    upcomingEvents: upcomingEvents,
    parseDate: parseDate,
    formatDate: formatDate,
    localDateKey: localDateKey,
    smsLink: smsLink,
    pricesOf: pricesOf,
    applyPrices: applyPrices,
    DAYS: DAYS,
    CATEGORIES: CATEGORIES,
    categoryOf: categoryOf,
    formatTime: formatTime,
    todayKey: todayKey,
    sortClasses: sortClasses,
    loadSchedule: loadSchedule,
    el: el
  };

  if (document.querySelector("[data-price]")) {
    loadSchedule().then(applyPrices).catch(function () { /* keep the printed prices */ });
  }
})();
