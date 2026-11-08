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
  var DEFAULT_PRICES = { twice: 100, once: 75, registration: 30 };
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

  window.SPS = {
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
