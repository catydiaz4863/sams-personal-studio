// Event cards for the Events page and the homepage "Coming up" section.
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;

  function card(e) {
    var type = S.eventType(e.type);
    var d = S.parseDate(e.date);
    var when = e.time ? S.formatTime(e.time) : "Time TBA";
    var dateShort = S.formatDate(e.date, { weekday: "short", month: "short", day: "numeric" });
    var signup = S.smsLink("Hi! I'd like to sign up for " + e.title + " on " + dateShort + ".");

    var body = [
      el("span", { class: "ev-type", text: type.label }),
      el("h3", { class: "ev-title", text: e.title }),
      el("p", { class: "ev-when", text: when })
    ];
    if (e.description) body.push(el("p", { class: "ev-desc", text: e.description }));
    var foot = [el("a", { class: "btn btn-small btn-pink", href: signup, text: "Text to sign up" })];
    if (e.price != null) foot.unshift(el("span", { class: "ev-price", text: e.price === 0 ? "Free" : "$" + e.price }));
    body.push(el("div", { class: "ev-foot" }, foot));

    var flyer = null;
    if (e.image) {
      flyer = el("a", { class: "ev-flyer", href: e.image, target: "_blank", rel: "noopener", "aria-label": "Open the flyer for " + e.title }, [
        el("img", { src: e.image, alt: "Flyer for " + e.title, loading: "lazy" })
      ]);
    }
    return el("article", { class: "ev-card" + (flyer ? " has-flyer" : ""), "data-cat": type.cat }, [
      flyer,
      el("div", { class: "ev-date", "aria-hidden": "true" }, [
        el("span", { class: "ev-month", text: d.toLocaleDateString("en-US", { month: "short" }) }),
        el("span", { class: "ev-day", text: String(d.getDate()) }),
        el("span", { class: "ev-dow", text: d.toLocaleDateString("en-US", { weekday: "short" }) })
      ]),
      el("div", { class: "ev-body" }, body)
    ]);
  }

  S.loadSchedule().then(function (data) {
    var events = S.upcomingEvents(data);

    // Events page
    var list = document.getElementById("event-list");
    if (list) {
      list.textContent = "";
      if (!events.length) {
        list.appendChild(el("div", { class: "ev-empty" }, [
          el("p", { text: "No events on the calendar right now." }),
          el("p", null, [
            document.createTextNode("Workshops and shows are announced here and on Instagram "),
            el("a", { href: "https://www.instagram.com/trainbysam", rel: "noopener", text: "@trainbysam" }),
            document.createTextNode(".")
          ])
        ]));
      } else {
        events.forEach(function (e) { list.appendChild(card(e)); });
      }
    }

    // Homepage: next two events, only when there are any
    var teaser = document.getElementById("home-events");
    if (teaser && events.length) {
      var holder = document.getElementById("home-event-list");
      events.slice(0, 3).forEach(function (e) {
        var d = S.parseDate(e.date);
        holder.appendChild(el("a", { class: "ev-mini", href: "/events", "data-cat": S.eventType(e.type).cat }, [
          el("span", { class: "ev-mini-date" }, [
            el("span", { text: d.toLocaleDateString("en-US", { month: "short" }) }),
            el("strong", { text: String(d.getDate()) })
          ]),
          el("span", { class: "ev-mini-text" }, [
            el("strong", { text: e.title }),
            el("span", { text: S.eventType(e.type).label + (e.time ? " · " + S.formatTime(e.time) : "") })
          ]),
          el("span", { class: "ed-chev", text: "›" })
        ]));
      });
      teaser.hidden = false;
    }
  }).catch(function () { /* leave the static text */ });
})();
