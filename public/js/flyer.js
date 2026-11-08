// Draws the monthly schedule as an image for Instagram / Facebook.
// Everything happens in the browser: no server, no cost.
//   SPSFlyer.render(schedule, "post" | "story") -> Promise<HTMLCanvasElement>
(function () {
  "use strict";
  var S = window.SPS;

  var C = {
    paper: "#fbf8f4", ink: "#17131a", soft: "#5a5260", line: "#e6dfd8", card: "#ffffff",
    pink: "#e04fa0", blue: "#168bcb", orange: "#f39553", green: "#8cc660", pinkInk: "#b02a77",
    timeBg: "#f3ede7"
  };
  var CAT = {
    pole: { bar: C.pink, tint: "#fbe4f0" },
    spin: { bar: C.blue, tint: "#dceef8" },
    exotic: { bar: C.orange, tint: "#fdeadb" },
    belly: { bar: C.green, tint: "#e8f4dc" },
    stretch: { bar: "#8a7f92", tint: "#efebf2" }
  };
  var SIZES = { post: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };
  var PHONE = "(956) 533-8273";
  var HANDLE = "@trainbysam";
  var ADDRESS = "4307 N 10th St, Ste E · McAllen, TX";

  var DISPLAY = '"Bricolage Grotesque", "Arial Black", sans-serif';
  var BODY = '"Figtree", "Helvetica Neue", Arial, sans-serif';
  var SCRIPT = '"Pacifico", "Brush Script MT", cursive';

  var logoPromise = null;
  function loadLogo() {
    if (!logoPromise) {
      logoPromise = new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = "/img/logo.png";
      });
    }
    return logoPromise;
  }

  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('800 80px "Bricolage Grotesque"'),
      document.fonts.load('700 30px "Figtree"'),
      document.fonts.load('500 30px "Figtree"'),
      document.fonts.load('400 40px "Pacifico"')
    ]).catch(function () { /* fall back to system fonts */ });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Split text into lines that fit maxWidth.
  function wrap(ctx, text, maxWidth) {
    // keep "1 & 2" / "3 & 4" together on one line
    var words = String(text).replace(/(\d)\s*&\s*(\d)/g, "$1\u00a0&\u00a0$2").split(/ +/);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    return lines;
  }

  // Largest font size (<= max) at which text fits in the box.
  function fitText(ctx, text, weight, family, max, min, boxW, boxH, maxLines) {
    for (var size = max; size >= min; size -= 1) {
      ctx.font = weight + " " + size + "px " + family;
      var lines = wrap(ctx, text, boxW);
      if (lines.length <= maxLines && lines.length * size * 1.12 <= boxH &&
          lines.every(function (l) { return ctx.measureText(l).width <= boxW; })) {
        return { size: size, lines: lines };
      }
    }
    ctx.font = weight + " " + min + "px " + family;
    return { size: min, lines: wrap(ctx, text, boxW).slice(0, maxLines) };
  }

  function drawStripe(ctx, x, y, w, h) {
    [C.pink, C.blue, C.orange, C.green].forEach(function (col, i) {
      ctx.fillStyle = col;
      ctx.fillRect(x + (w / 4) * i, y, Math.ceil(w / 4) + 1, h);
    });
  }

  function render(schedule, format) {
    var size = SIZES[format] || SIZES.post;
    return Promise.all([loadLogo(), loadFonts()]).then(function (res) {
      var logo = res[0];
      var W = size.w, H = size.h, story = format === "story";
      var canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext("2d");
      ctx.textBaseline = "alphabetic";

      // background + top stripe
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, W, H);
      drawStripe(ctx, 0, 0, W, 16);

      var M = 60; // side margin
      var y;

      // ---------- header ----------
      if (story) {
        // big centered logo, then month
        var lw = 520, lh = logo ? lw * logo.height / logo.width : 0;
        if (logo) ctx.drawImage(logo, (W - lw) / 2, 90, lw, lh);
        y = 90 + lh + 70;
        ctx.textAlign = "center";
        ctx.fillStyle = C.soft;
        ctx.font = "700 30px " + BODY;
        ctx.fillText("CLASS SCHEDULE", W / 2, y);
        y += 96;
        var t = fitText(ctx, schedule.month || "This month", "800", DISPLAY, 104, 56, W - 2 * M, 120, 1);
        ctx.fillStyle = C.ink;
        ctx.font = "800 " + t.size + "px " + DISPLAY;
        ctx.fillText(t.lines[0], W / 2, y);
        y += 60;
      } else {
        // logo left, month right
        var lw2 = 300, lh2 = logo ? lw2 * logo.height / logo.width : 0;
        if (logo) ctx.drawImage(logo, M - 6, 52, lw2, lh2);
        var rx = M + lw2 + 34, rw = W - M - rx;
        ctx.textAlign = "left";
        ctx.fillStyle = C.soft;
        ctx.font = "700 26px " + BODY;
        ctx.fillText("CLASS SCHEDULE", rx, 120);
        var t2 = fitText(ctx, schedule.month || "This month", "800", DISPLAY, 84, 44, rw, 180, 2);
        ctx.fillStyle = C.ink;
        ctx.font = "800 " + t2.size + "px " + DISPLAY;
        t2.lines.forEach(function (line, i) { ctx.fillText(line, rx, 120 + t2.size * 1.05 * (i + 1)); });
        y = Math.max(52 + lh2, 120 + t2.size * 1.05 * t2.lines.length) + 44;
      }

      // ---------- grid ----------
      var classes = (schedule.classes || []).filter(function (c) { return c.name && c.time && c.day; });
      var days = S.DAYS.filter(function (d) { return classes.some(function (c) { return c.day === d.key; }); });
      var times = Array.from(new Set(classes.map(function (c) { return c.time; }))).sort();

      var footerH = story ? 400 : 250;
      var prices = S.pricesOf(schedule);
      var priceLine = "$" + prices.twice + "/mo twice a week  ·  $" + prices.once + "/mo once a week";
      var feeLine = "$" + prices.registration + " one-time registration fee for new students";
      var gridTop = y;
      var gridBottom = H - footerH - 30;
      var gx = M, gw = W - 2 * M;
      var timeW = story ? 170 : 160;
      var headH = story ? 74 : 62;
      var rowsH = gridBottom - gridTop - headH;
      var rowH = times.length ? Math.min(story ? 150 : 128, rowsH / times.length) : 0;
      var gh = headH + rowH * times.length;
      var colW = days.length ? (gw - timeW) / days.length : 0;
      var pad = days.length > 5 ? 6 : 9;

      if (!days.length) {
        ctx.textAlign = "center";
        ctx.fillStyle = C.soft;
        ctx.font = "600 40px " + BODY;
        ctx.fillText("New schedule coming soon", W / 2, gridTop + 160);
      } else {
        // card behind the grid
        ctx.save();
        ctx.shadowColor = "rgba(23,19,26,0.08)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 6;
        roundRect(ctx, gx, gridTop, gw, gh, 22);
        ctx.fillStyle = C.card;
        ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, gx, gridTop, gw, gh, 22);
        ctx.clip();

        // header row
        ctx.fillStyle = C.ink;
        ctx.fillRect(gx, gridTop, gw, headH);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "800 " + (story ? 28 : 25) + "px " + BODY;
        ctx.fillText("TIME", gx + timeW / 2, gridTop + headH / 2 + 9);
        days.forEach(function (d, i) {
          ctx.fillText(d.short.toUpperCase(), gx + timeW + colW * i + colW / 2, gridTop + headH / 2 + 9);
        });

        // time column background
        ctx.fillStyle = C.timeBg;
        ctx.fillRect(gx, gridTop + headH, timeW, rowH * times.length);

        times.forEach(function (time, r) {
          var ry = gridTop + headH + rowH * r;
          // row line
          if (r > 0) { ctx.fillStyle = C.line; ctx.fillRect(gx, ry, gw, 2); }
          // time label
          ctx.fillStyle = C.ink;
          ctx.textAlign = "center";
          ctx.font = "800 " + (story ? 30 : 27) + "px " + BODY;
          ctx.fillText(S.formatTime(time), gx + timeW / 2, ry + rowH / 2 + 10);

          days.forEach(function (d, ci) {
            var cx = gx + timeW + colW * ci;
            var here = classes.filter(function (c) { return c.day === d.key && c.time === time; });
            if (!here.length) return;
            var cellH = (rowH - pad * 2 - (here.length - 1) * 6) / here.length;
            here.forEach(function (c, k) {
              var cy = ry + pad + k * (cellH + 6);
              var cat = CAT[S.categoryOf(c.name)] || CAT.pole;
              roundRect(ctx, cx + pad, cy, colW - pad * 2, cellH, 12);
              ctx.fillStyle = cat.tint;
              ctx.fill();
              ctx.save();
              roundRect(ctx, cx + pad, cy, colW - pad * 2, cellH, 12);
              ctx.clip();
              ctx.fillStyle = cat.bar;
              ctx.fillRect(cx + pad, cy, colW - pad * 2, 7);
              ctx.restore();
              var box = colW - pad * 2 - 16;
              var fit = fitText(ctx, c.name, "800", BODY, story ? 30 : 26, 15, box, cellH - 18, 3);
              ctx.fillStyle = C.ink;
              ctx.font = "800 " + fit.size + "px " + BODY;
              var lh3 = fit.size * 1.12;
              var startY = cy + 4 + cellH / 2 - (fit.lines.length * lh3) / 2 + fit.size * 0.85;
              fit.lines.forEach(function (line, li) { ctx.fillText(line, cx + colW / 2, startY + li * lh3); });
            });
          });
        });

        // column lines
        ctx.fillStyle = C.line;
        ctx.fillRect(gx + timeW, gridTop + headH, 2, rowH * times.length);
        for (var i = 1; i < days.length; i++) ctx.fillRect(gx + timeW + colW * i, gridTop + headH, 2, rowH * times.length);
        ctx.restore();
      }

      // ---------- footer ----------
      var fy = H - footerH;
      ctx.textAlign = "center";
      ctx.fillStyle = C.ink;
      ctx.font = "800 " + (story ? 36 : 31) + "px " + BODY;
      ctx.fillText(priceLine, W / 2, fy + (story ? 40 : 34));
      var by = fy + (story ? 76 : 60);
      if (story) {
        roundRect(ctx, M, by, gw, 190, 26);
        ctx.fillStyle = C.ink;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "800 46px " + DISPLAY;
        ctx.fillText("Book now: text " + PHONE, W / 2, by + 82);
        ctx.fillStyle = "#e9c3da";
        ctx.font = "600 32px " + BODY;
        ctx.fillText(feeLine, W / 2, by + 140);
        ctx.fillStyle = C.ink;
        ctx.font = "400 44px " + SCRIPT;
        ctx.fillText(HANDLE, W / 2, by + 268);
      } else {
        roundRect(ctx, M, by, gw, 108, 22);
        ctx.fillStyle = C.ink;
        ctx.fill();
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "800 38px " + DISPLAY;
        ctx.fillText("Book now: text " + PHONE, M + 34, by + 50);
        ctx.fillStyle = "#e9c3da";
        ctx.font = "600 25px " + BODY;
        ctx.fillText(feeLine, M + 34, by + 86);
        ctx.textAlign = "right";
        ctx.fillStyle = "#fff";
        ctx.font = "400 34px " + SCRIPT;
        ctx.fillText(HANDLE, W - M - 34, by + 70);
        ctx.textAlign = "center";
        ctx.fillStyle = C.soft;
        ctx.font = "600 24px " + BODY;
        ctx.fillText(ADDRESS, W / 2, by + 150);
      }
      drawStripe(ctx, 0, H - 16, W, 16);
      return canvas;
    });
  }

  window.SPSFlyer = { render: render };
})();
