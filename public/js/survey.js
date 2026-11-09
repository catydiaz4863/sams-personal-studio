// Renders any survey from /survey?id=... (shareable link).
// The class review can preselect a class: /survey?id=review&class=Intro%20to%20Spin
(function () {
  "use strict";
  var S = window.SPS;
  var el = S.el;
  var params = new URLSearchParams(location.search);
  var id = params.get("id") || "review";
  var root = document.getElementById("survey");
  var started = Date.now();
  var answers = {};
  var survey = null;

  fetch("/api/survey?id=" + encodeURIComponent(id), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) return message("Survey not found", "This link doesn't match a survey. Check the link and try again.");
      if (data.closed) return message(data.title || "Survey closed", "This survey isn't taking answers anymore. Thank you!");
      survey = data;
      render();
    })
    .catch(function () { message("Couldn't load the survey", "Check your connection and try again."); });

  function message(title, text) {
    root.textContent = "";
    root.appendChild(el("div", { class: "sv-done" }, [el("h1", { text: title }), el("p", { text: text })]));
  }

  function chipGroup(q, options, multi) {
    var wrap = el("div", { class: "chips sv-chips", role: multi ? "group" : "radiogroup" });
    var preset = q.type === "class" ? params.get("class") : null;
    if (preset && options.indexOf(preset) !== -1) answers[q.id] = preset;
    options.forEach(function (o) {
      var b = el("button", { type: "button", class: "chip" });
      b.textContent = o;
      function sync() {
        var on = multi ? (answers[q.id] || []).indexOf(o) !== -1 : answers[q.id] === o;
        b.setAttribute("aria-pressed", String(on));
      }
      b.addEventListener("click", function () {
        if (multi) {
          var list = answers[q.id] || [];
          var i = list.indexOf(o);
          if (i === -1) list.push(o); else list.splice(i, 1);
          answers[q.id] = list;
        } else {
          answers[q.id] = answers[q.id] === o ? undefined : o;
        }
        wrap.querySelectorAll(".chip").forEach(function (c) { c._sync(); });
      });
      b._sync = sync;
      sync();
      wrap.appendChild(b);
    });
    return wrap;
  }

  function stars(q) {
    var wrap = el("div", { class: "sv-stars", role: "radiogroup", "aria-label": q.label });
    for (var n = 1; n <= 5; n++) {
      (function (n) {
        var b = el("button", { type: "button", class: "sv-star", "aria-label": n + (n === 1 ? " star" : " stars"), text: "★" });
        b.addEventListener("click", function () {
          answers[q.id] = n;
          wrap.querySelectorAll(".sv-star").forEach(function (s, i) { s.classList.toggle("on", i < n); s.setAttribute("aria-pressed", String(i < n)); });
        });
        wrap.appendChild(b);
      })(n);
    }
    return wrap;
  }

  function scale(q) {
    var wrap = el("div", { class: "sv-scale" });
    for (var n = 0; n <= 10; n++) {
      (function (n) {
        var b = el("button", { type: "button", class: "sv-num", text: String(n), "aria-pressed": "false" });
        b.addEventListener("click", function () {
          answers[q.id] = n;
          wrap.querySelectorAll(".sv-num").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        });
        wrap.appendChild(b);
      })(n);
    }
    return el("div", null, [wrap, el("div", { class: "sv-scale-ends" }, [el("span", { text: "Not likely" }), el("span", { text: "Very likely" })])]);
  }

  function text(q) {
    var input = q.long
      ? el("textarea", { class: "sv-input", rows: "3", maxlength: "280", placeholder: q.placeholder || "" })
      : el("input", { class: "sv-input", type: "text", maxlength: "60", placeholder: q.placeholder || "" });
    input.addEventListener("input", function () { answers[q.id] = input.value; });
    return input;
  }

  function render() {
    root.textContent = "";
    var form = el("form", { class: "sv-form", novalidate: "" });
    if (survey.event) form.appendChild(el("p", { class: "sv-event", text: survey.event.title + " · " + S.formatDate(survey.event.date, { weekday: "short", month: "short", day: "numeric" }) }));
    form.appendChild(el("h1", { text: survey.title }));
    if (survey.intro) form.appendChild(el("p", { class: "lede", text: survey.intro }));

    survey.questions.forEach(function (q) {
      var field;
      if (q.type === "stars") field = stars(q);
      else if (q.type === "scale") field = scale(q);
      else if (q.type === "choice") field = chipGroup(q, q.options, false);
      else if (q.type === "multi") field = chipGroup(q, q.options, true);
      else if (q.type === "class") field = chipGroup(q, survey.classes || [], false);
      else field = text(q);
      var label = el("p", { class: "sv-q", text: q.label + (q.required ? " *" : "") });
      form.appendChild(el("div", { class: "sv-block", "data-q": q.id }, [label, field]));
    });

    // hidden field only bots fill in
    var hp = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", class: "visually-hidden", "aria-hidden": "true" });
    form.appendChild(hp);
    var err = el("p", { class: "sv-error", role: "alert" });
    var btn = el("button", { type: "submit", class: "btn btn-pink sv-submit", text: "Send" });
    form.appendChild(err);
    form.appendChild(btn);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.textContent = "";
      var missing = survey.questions.filter(function (q) {
        var v = answers[q.id];
        return q.required && (v === undefined || v === "" || (Array.isArray(v) && !v.length));
      })[0];
      if (missing) {
        err.textContent = "Please answer: " + missing.label;
        form.querySelector('[data-q="' + missing.id + '"]').scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      btn.disabled = true;
      btn.textContent = "Sending…";
      fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: survey.id, answers: answers, website: hp.value, ms: Date.now() - started })
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body.error || "Couldn't send. Try again.");
          thanks();
        })
        .catch(function (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Send"; });
    });
    root.appendChild(form);
  }

  function thanks() {
    root.textContent = "";
    var box = el("div", { class: "sv-done" }, [
      el("h1", { text: "Thank you! 💕" }),
      el("p", { text: survey.kind === "review" ? "Your review was sent to Sam. Once approved, it shows up on the website." : "Your answers were sent to the studio." })
    ]);
    box.appendChild(el("div", { class: "hero-actions" }, [
      el("a", { class: "btn btn-pink", href: "/schedule", text: "See the schedule" }),
      el("a", { class: "btn btn-ghost", href: "https://www.instagram.com/trainbysam", rel: "noopener", text: "Follow @trainbysam" })
    ]));
    root.appendChild(box);
    window.scrollTo(0, 0);
  }
})();
