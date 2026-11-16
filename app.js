/* ============================================================
   SkyCred — client logic
   FR1 search · FR2 dashboard · FR3 popular cities
   FR4 formatted/raw JSON views · FR5 copy · FR6 /api/weather proxy
   ============================================================ */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // PRD 5.2 — the popular-city list lives here (single source of truth).
  // Edit this array to change the chips; no other component needs touching.
  var POPULAR_CITIES = ["Mumbai", "Pune", "Delhi", "Bengaluru", "Hyderabad", "Chennai"];

  var els = {
    form: $("search-form"),
    input: $("city-input"),
    btn: $("search-btn"),
    status: $("status-region"),
    dashboard: $("dashboard"),
    dataViews: $("data-views"),
    jsonOutput: $("json-output"),
    copyBtn: $("copy-btn"),
    tabs: document.querySelectorAll(".tab"),
    gauge: $("gauge"),
    needle: $("needle"),
    gaugeTemp: $("gauge-temp"),
    gaugeBand: $("gauge-band"),
    locName: $("loc-name"),
    locMeta: $("loc-meta"),
    locTime: $("loc-time"),
    condIcon: $("cond-icon"),
    condText: $("cond-text"),
    updatedAt: $("updated-at"),
    mFeels: $("m-feels"),
    mHumidity: $("m-humidity"),
    mWind: $("m-wind"),
    mUv: $("m-uv")
  };

  // Latest successful search — both views are derived from this single response.
  var state = { formatted: "", raw: "", view: "formatted", lastCity: "" };

  /* ------------------------------------------------------------
     Analytics (section 11). Pluggable: window.skycredAnalytics
     can be replaced by a real provider (e.g. Plausible/GA4) that
     accepts a payload {event, ...props}. No personal data collected.
     ------------------------------------------------------------ */
  function track(event, props) {
    var payload = Object.assign({ event: event }, props || {});
    if (typeof window.skycredAnalytics === "function") {
      try { window.skycredAnalytics(payload); } catch (e) { /* analytics must never break the app */ }
    }
    if (window.console && console.debug) console.debug("[skycred]", payload);
  }

  /* ------------------------------------------------------------
     Status banners (loading / error / empty)
     ------------------------------------------------------------ */
  function clearStatus() { els.status.innerHTML = ""; }

  function showLoading(city) {
    els.btn.disabled = true;
    els.btn.textContent = "Checking…";
    els.status.innerHTML =
      '<div class="banner is-loading" role="status">⏳ Fetching current weather for <strong></strong>…</div>';
    els.status.querySelector("strong").textContent = city;
  }

  function showError(message, city) {
    els.status.innerHTML =
      '<div class="banner is-error" role="alert">⚠️ <div><span class="banner-msg"></span>' +
      (city ? ' <button type="button" class="retry-btn">Retry “<span class="retry-city"></span>”</button>' : "") +
      "</div></div>";
    els.status.querySelector(".banner-msg").textContent = message;
    var retry = els.status.querySelector(".retry-btn");
    if (retry) {
      els.status.querySelector(".retry-city").textContent = city;
      retry.addEventListener("click", function () { lookup(city, "retry"); });
      retry.focus();
    }
  }

  function busy(busyOn) {
    els.btn.disabled = busyOn;
    els.btn.textContent = busyOn ? "Checking…" : "Check weather";
    if (els.dashboard && !els.dashboard.hidden) {
      if (busyOn) els.dashboard.setAttribute("aria-busy", "true");
      else els.dashboard.removeAttribute("aria-busy");
    }
  }

  /* ------------------------------------------------------------
     FR1 + FR6 — city lookup through the serverless proxy
     ------------------------------------------------------------ */
  function lookup(city, source) {
    city = String(city || "").trim();
    if (!city) {
      // FR1: empty searches are not submitted.
      showError("Please enter a city name to search.");
      els.input.focus();
      return;
    }

    if (source === "search") track("city_search_submitted", { query: city });

    showLoading(city);
    busy(true);
    var startedAt = (window.performance && performance.now()) || Date.now();

    fetch("/api/weather?city=" + encodeURIComponent(city))
      .then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, ok: res.ok, text: text };
        });
      })
      .then(function (res) {
        var latencyMs = Math.round(((window.performance && performance.now()) || Date.now()) - startedAt);
        var data = null;
        try { data = JSON.parse(res.text); } catch (e) { /* non-JSON error body */ }

        if (!res.ok || !data || data.error) {
          var err = (data && data.error) || {};
          var status = res.status;
          var message;
          if (status === 404) {
            message = 'We couldn\u2019t find \u201C' + city + '\u201D. Check the spelling or try a nearby major city.';
          } else if (status === 429) {
            message = err.message || "The weather service is receiving too many requests right now. Please wait a moment and try again.";
          } else if (status === 502 || status === 503) {
            message = err.message || "The weather service is temporarily unavailable. Please try again shortly.";
          } else if (status === 500) {
            message = err.message || "Something went wrong on our side. Please try again.";
          } else {
            message = err.message || "The weather lookup failed. Please try again.";
          }
          showError(message, city);
          // FR1: failed searches never replace previously displayed data.
          track("weather_search_failed", {
            query: city,
            status: status,
            code: err.code || null,
            reason: message.slice(0, 120),
            latency_ms: latencyMs
          });
          busy(false);
          return;
        }

        state.formatted = JSON.stringify(data, null, 2);
        state.raw = res.text;
        state.lastCity = city;
        render(data, city);
        clearStatus();
        busy(false);
        track("weather_search_success", {
          query: city,
          resolved_location: data.location && [data.location.name, data.location.country].filter(Boolean).join(", "),
          latency_ms: latencyMs
        });
      })
      .catch(function () {
        var latencyMs = Math.round(((window.performance && performance.now()) || Date.now()) - startedAt);
        showError("Network problem — check your connection and try again.", city);
        track("weather_search_failed", { query: city, status: 0, code: "NETWORK", latency_ms: latencyMs });
        busy(false);
      });
  }

  /* ------------------------------------------------------------
     FR2 — dashboard rendering (missing values handled gracefully)
     ------------------------------------------------------------ */
  function fmt(value) {
    return (value === 0 ? "0" : (value == null || value === "" || isNaN(Number(value)) ? "--" : String(value)));
  }

  var TEMP_MIN = -10, TEMP_MAX = 45;

  function bandLabel(t) {
    if (t == null || isNaN(t)) return "Awaiting data";
    if (t < 0) return "Freezing";
    if (t < 10) return "Cold";
    if (t < 20) return "Cool";
    if (t < 28) return "Mild";
    if (t < 35) return "Warm";
    return "Hot";
  }

  function render(data, city) {
    var loc = (data && data.location) || {};
    var cur = (data && data.current) || {};

    // Location (disambiguation via region + country)
    var nameParts = [loc.name, loc.region, loc.country].filter(Boolean);
    els.locName.textContent = nameParts.join(", ") || city;
    els.locMeta.textContent = loc.tz_id ? "Time zone: " + loc.tz_id : "";
    var localTime = typeof loc.localtime === "string" ? loc.localtime.split(" ")[1] : "";
    els.locTime.textContent = localTime ? "Local " + localTime : "--:--";

    // Gauge: temperature dial (brand metaphor — not a score)
    var t = typeof cur.temp_c === "number" ? cur.temp_c : null;
    var clamped = t == null ? TEMP_MIN : Math.max(TEMP_MIN, Math.min(TEMP_MAX, t));
    var angle = -90 + ((clamped - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 180;
    els.needle.style.setProperty("--needle-angle", angle.toFixed(1) + "deg");
    els.gaugeTemp.textContent = (t == null ? "--" : Math.round(t)) + "°";
    els.gaugeBand.textContent = bandLabel(t);
    els.gauge.setAttribute(
      "aria-label",
      "Temperature gauge showing " + (t == null ? "no reading" : Math.round(t) + " degrees Celsius")
    );

    // Condition
    if (cur.condition && cur.condition.icon) {
      els.condIcon.src = "https:" + cur.condition.icon;
      els.condIcon.alt = cur.condition.text || "Weather condition icon";
      els.condIcon.hidden = false;
    } else {
      els.condIcon.hidden = true;
      els.condIcon.removeAttribute("src");
      els.condIcon.alt = "";
    }
    els.condText.textContent = (cur.condition && cur.condition.text) || "Conditions unavailable";

    // Last updated (stale-data mitigation, section 12)
    els.updatedAt.textContent = cur.last_updated ? "Updated: " + cur.last_updated : "Updated: --";

    // Metrics
    els.mFeels.textContent = fmt(cur.feelslike_c);
    els.mHumidity.textContent = fmt(cur.humidity);
    els.mWind.textContent = fmt(cur.wind_kph);
    els.mUv.textContent = fmt(cur.uv);

    // PRD 5.2 — visually indicate the currently selected popular city.
    markSelectedChip(city);

    // Data views + dashboard
    els.dashboard.hidden = false;
    els.dataViews.hidden = false;
    renderJsonView();

    if (els.dashboard.scrollIntoView && window.matchMedia("(max-width: 720px)").matches) {
      els.dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ------------------------------------------------------------
     FR4 — formatted / raw JSON views (no refetch on switch)
     ------------------------------------------------------------ */
  function renderJsonView() {
    var content = state.view === "formatted" ? state.formatted : state.raw;
    var code = els.jsonOutput.querySelector("code");
    code.textContent = content || "No data yet — run a search first.";
  }

  Array.prototype.forEach.call(els.tabs, function (tab) {
    tab.addEventListener("click", function () {
      var view = tab.getAttribute("data-view");
      if (view === state.view) return;
      state.view = view;
      Array.prototype.forEach.call(els.tabs, function (t) {
        var active = t.getAttribute("data-view") === view;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderJsonView();
      resetCopyLabel();
      track("json_view_switched", { view: view });
    });
  });

  /* ------------------------------------------------------------
     FR5 — copy with visible confirmation + graceful failure
     ------------------------------------------------------------ */
  var copyResetTimer = null;
  function resetCopyLabel() {
    els.copyBtn.textContent = "Copy";
    els.copyBtn.classList.remove("is-copied");
  }

  function legacyCopy(text, onDone) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    onDone(ok);
  }

  els.copyBtn.addEventListener("click", function () {
    var text = state.view === "formatted" ? state.formatted : state.raw;
    if (!text) {
      showError("There is no weather data to copy yet — run a search first.");
      return;
    }
    var done = function (ok) {
      if (ok) {
        els.copyBtn.textContent = "Copied ✓";
        els.copyBtn.classList.add("is-copied");
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(resetCopyLabel, 2000);
      } else {
        showError("Copying failed — your browser blocked clipboard access. Select the text in the view and copy it manually.");
      }
      track("weather_data_copied", { view: state.view, success: ok });
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  });

  /* ------------------------------------------------------------
     FR1 + FR3 — search form & popular cities
     ------------------------------------------------------------ */
  els.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var city = els.input.value.trim();
    if (!city) {
      // FR1: empty searches are not submitted.
      showError("Please enter a city name to search.");
      els.input.focus();
      return;
    }
    lookup(city, "search");
  });

  /* ------------------------------------------------------------
     FR3 (PRD 5.2) — popular-city chips rendered from configuration,
     with the currently selected city visually indicated.
     ------------------------------------------------------------ */
  function markSelectedChip(city) {
    var needle = String(city || "").trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {
      var selected = needle !== "" && chip.getAttribute("data-city").toLowerCase() === needle;
      chip.classList.toggle("is-selected", selected);
      chip.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function renderPopularChips() {
    var container = document.querySelector(".popular");
    if (!container) return;
    // Keep the "Popular:" label, clear any existing chips.
    Array.prototype.forEach.call(container.querySelectorAll(".chip"), function (chip) {
      chip.parentNode.removeChild(chip);
    });
    POPULAR_CITIES.forEach(function (city) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("data-city", city);
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = city;
      chip.addEventListener("click", function () {
        els.input.value = city;
        track("popular_city_selected", { city: city });
        lookup(city, "popular");
      });
      container.appendChild(chip);
    });
  }

  renderPopularChips();
})();
