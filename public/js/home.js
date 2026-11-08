// Home page: "Tonight at the studio" strip, pulled from the live schedule.
(function () {
  "use strict";
  var S = window.SPS;
  var box = document.getElementById("today");
  if (!box) return;

  S.loadSchedule().then(function (data) {
    var classes = data.classes || [];
    if (!classes.length) return;

    var todayIdx = S.DAYS.findIndex(function (d) { return d.key === S.todayKey(); });
    var nowHHMM = new Date().toTimeString().slice(0, 5);

    // Find today's remaining classes, otherwise the next day that has classes.
    var pick = null;
    for (var offset = 0; offset < 7 && !pick; offset++) {
      var day = S.DAYS[(todayIdx + offset) % 7];
      var list = S.sortClasses(classes.filter(function (c) {
        return c.day === day.key && (offset > 0 || c.time >= nowHHMM);
      }));
      if (list.length) pick = { day: day, offset: offset, list: list };
    }
    if (!pick) return;

    var title = pick.offset === 0 ? "Still to come today" :
      pick.offset === 1 ? "Tomorrow at the studio" : "Next up: " + pick.day.long;

    var ul = S.el("ul", { class: "today-list" });
    pick.list.forEach(function (c) {
      var li = S.el("li", { "data-cat": S.categoryOf(c.name) }, [
        S.el("time", { text: S.formatTime(c.time) }),
        S.el("span", { text: c.name })
      ]);
      ul.appendChild(li);
    });

    box.querySelector("h2").textContent = title;
    box.appendChild(ul);
    box.hidden = false;
  }).catch(function () { /* leave the strip hidden */ });
})();
