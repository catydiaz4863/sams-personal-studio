// Approved reviews on the Classes page and the homepage.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;

  function starText(n) { return "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n)); }
  function reviewLink(cls) { return "/survey?id=review" + (cls ? "&class=" + encodeURIComponent(cls) : ""); }

  function quote(r, showClass) {
    var meta = r.name + (showClass ? " · " + r.class : "");
    var kids = [el("span", { class: "rv-stars", "aria-label": r.stars + " out of 5 stars", text: starText(r.stars) })];
    if (r.comment) kids.push(el("p", { class: "rv-text", text: "“" + r.comment + "”" }));
    else if (r.tags.length) kids.push(el("p", { class: "rv-text", text: r.tags.join(" · ") }));
    kids.push(el("span", { class: "rv-meta", text: "– " + meta }));
    return el("figure", { class: "rv-card", "data-cat": S.categoryOf(r.class) }, kids);
  }

  // Featured first, then newest; only reviews with something to read.
  function best(list, n) {
    return list.filter(function (r) { return r.comment || r.tags.length; })
      .sort(function (a, b) { return (b.featured - a.featured) || b.date.localeCompare(a.date); })
      .slice(0, n);
  }

  // Every class card gets a "Leave a review" link (hidden if the review
  // survey is closed or uses one-time links).
  var cards = document.querySelectorAll(".class-card");
  fetch("/api/survey-links").then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.reviewPublic === false) {
      document.querySelectorAll(".rv-link, #reviews-strip .events-head a").forEach(function (a) { a.hidden = true; });
    }
  }).catch(function () {});
  cards.forEach(function (card) {
    var name = card.querySelector("h3").textContent.trim();
    var row = el("div", { class: "rv-row" }, [
      el("span", { class: "rv-avg" }),
      el("a", { class: "rv-link", href: reviewLink(name), text: "Leave a review" })
    ]);
    card.appendChild(row);
  });

  fetch("/api/reviews").then(function (r) { return r.json(); }).then(function (list) {
    if (!Array.isArray(list) || !list.length) return;

    // Classes page: average stars per class + students' words
    cards.forEach(function (card) {
      var name = card.querySelector("h3").textContent.trim();
      var mine = list.filter(function (r) { return r.class === name; });
      if (!mine.length) return;
      var avg = mine.reduce(function (s, r) { return s + r.stars; }, 0) / mine.length;
      card.querySelector(".rv-avg").textContent = starText(avg) + " " + avg.toFixed(1) + " (" + mine.length + ")";
      var top = best(mine, 1)[0];
      if (top && top.comment) card.insertBefore(el("p", { class: "rv-inline", text: "“" + top.comment + "” – " + top.name }), card.querySelector(".rv-row"));
    });

    // "What students say" (Classes page + homepage)
    var strip = document.getElementById("reviews-strip");
    if (strip) {
      var holder = strip.querySelector(".rv-list");
      var picks = best(list, strip.getAttribute("data-count") ? +strip.getAttribute("data-count") : 3);
      if (!picks.length) return;
      picks.forEach(function (r) { holder.appendChild(quote(r, true)); });
      strip.hidden = false;
    }
  }).catch(function () { /* reviews are a bonus; ignore errors */ });
})();
