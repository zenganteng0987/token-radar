// Token Radar v3 dashboard. Renders window.RADAR (written beside dashboard/
// by main.ts): a ranked board of pre-token protocols with the value model's
// working shown per protocol, a sector overview of the category multiples
// the model reads from, an implied-value scatter, category farm playbooks,
// a spotlight of the top opportunities, and the already-trading peers behind
// the multiples. Static page, no network. A view can be named in the
// address: ?select=<slug>&cat=<category>&watch=1&q=<text>&view=tokened
// &sort=<key>
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !app) return;
  var rows = R.rows;

  /* ---------- identity + category colour system ---------- */
  // One logomark everywhere the product signs itself: a radar sweep with
  // two blips, drawn in the palette's own royal blue and amber.
  var MARK = '<svg class="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="13" stroke="#3d4a63" stroke-width="1.6"/>' +
    '<circle cx="16" cy="16" r="7" stroke="#2a3347" stroke-width="1.2"/>' +
    '<path d="M16 16 L16 3.5 A12.5 12.5 0 0 1 25.6 8 Z" fill="#2e6bff" opacity=".85"/>' +
    '<circle cx="21.5" cy="20.5" r="1.9" fill="#f5a524"/>' +
    '<circle cx="10.5" cy="12" r="1.4" fill="#5b93ff"/>' +
    '<circle cx="16" cy="16" r="1.7" fill="#f2f4f8"/></svg>';
  // Each major category owns one hue, used for its dots, bars, chips and
  // names everywhere it appears. Hues are muted, and every one of them
  // clears 4.5:1 on the panel colour so it can carry text, not just fills.
  // Bridge categories are one family and share the steel blue; anything
  // unlisted falls back to the slate used for minor categories.
  var CAT_HUE = {
    'Risk Curators': '#a78bfa',
    'Dexs': '#5b93ff',
    'Onchain Capital Allocator': '#45c4b0',
    'RWA': '#f5a524',
    'Lending': '#2fd48c',
    'Yield': '#a6c94c',
    'Derivatives': '#ff6b81',
    'CDP': '#f08a4b',
    'Yield Aggregator': '#4fb8d8',
    'Basis Trading': '#c9a86a',
    'Privacy': '#d97bc4',
    'Bridge': '#7fa6c9',
    'Canonical Bridge': '#7fa6c9',
    'Cross Chain Bridge': '#7fa6c9',
  };
  var CAT_FALLBACK = '#7d879c';
  function catHue(c) { return CAT_HUE[c] || CAT_FALLBACK; }
  function catStyle(c) { return ' style="--ch:' + catHue(c) + '"'; }
  function catTag(c) {
    return '<span class="catname"' + catStyle(c) + '><i class="cdot"></i>' + esc(c) + '</span>';
  }

  /* ---------- formatting ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  // Axis ticks sit on exact powers of ten, so they drop the decimals:
  // $10B is 23 units wide where $10.00B is 41 and clipped at the edge.
  function tick(v) {
    if (v >= 1e9) return '$' + (v / 1e9) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3) + 'K';
    return '$' + v;
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="ratio">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    var arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '';
    return '<span class="' + cls + '">' + arrow + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function mult(v) { return '×' + v.toFixed(2); }
  function tierOf(rank) { return rank <= 10 ? 'S' : rank <= 50 ? 'A' : rank <= 120 ? 'B' : 'C'; }
  function tierName(t) {
    return { S: 'Prime', A: 'Strong', B: 'Tracked', C: 'Watch' }[t];
  }
  function tierBadge(rank) {
    var t = tierOf(rank);
    return '<span class="tier tier-' + t + '" title="Tier ' + t + ' — ' + tierName(t) + '">' + t + '</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unreported';
    if (days < 90) return days + ' days';
    return days.toLocaleString('en-US') + ' days (' + (days / 365.25).toFixed(1) + ' yrs)';
  }
  function log10(v) { return Math.log(v) / Math.LN10; }

  /* ---------- state ---------- */
  var params = new URLSearchParams(window.location.search);
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    watch: params.get('watch') === '1',
    view: params.get('view') === 'tokened' ? 'tokened' : 'board',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') === '-1' ? -1 : 1,
    selected: bySlug[params.get('select') || ''] ? params.get('select') : (rows.length ? rows[0].slug : null),
  };
  var maxRatio = 0;
  rows.forEach(function (r) { var x = r.implied_value_usd / r.tvl_usd; if (x > maxRatio) maxRatio = x; });

  /* ---------- responsive charts ---------- */
  // Below 640 px the desktop chart geometry would shrink its labels to
  // about 5 px, so the charts switch to a compact geometry with larger
  // relative type. A resize only re-renders when the mode flips.
  var compact = window.innerWidth < 640;

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.watch) p.set('watch', '1');
    if (state.view !== 'board') p.set('view', state.view);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir !== 1) p.set('dir', '-1');
    if (state.selected) p.set('select', state.selected);
    var qs = p.toString();
    window.history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }

  /* ---------- charts (inline SVG, drawn from the data itself) ---------- */
  // Tiny distribution of the board's implied values, log buckets.
  function histogram() {
    var edges = [0, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9];
    var counts = [0, 0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) {
      for (var i = 0; i < 7; i++) {
        if (r.implied_value_usd < edges[i + 1]) { counts[i]++; return; }
      }
      counts[6]++;
    });
    var max = Math.max.apply(null, counts.concat([1]));
    var bars = counts.map(function (c, i) {
      var h = Math.max(2, Math.round(26 * c / max));
      return '<rect x="' + (i * 13 + 1) + '" y="' + (30 - h) + '" width="9" height="' + h + '" rx="1.5" class="hb"/>';
    }).join('');
    return '<svg class="hist" viewBox="0 0 92 32" role="img" aria-label="Distribution of implied values">' + bars + '</svg>';
  }

  // Horizontal bars of the highest category multiples: the sector view.
  // Dashed hairlines mark quarters of the scale behind the bars, and each
  // bar carries its category's own colour.
  function sectorChart() {
    var cms = R.category_multiples.slice().sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 10);
    var max = cms.length ? cms[0].multiple : 1;
    var W = compact ? 320 : 560, rowh = compact ? 26 : 21, top = compact ? 4 : 6;
    var labelW = compact ? 116 : 148, barX = labelW + (compact ? 6 : 8);
    var barW = W - barX - (compact ? 48 : 112);
    var base = compact ? 16 : 14, barY = compact ? 6 : 4, barH = compact ? 13 : 12;
    var H = top * 2 + cms.length * rowh;
    var s = '<svg class="sectorchart' + (compact ? ' compact' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Category multiples chart">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var gx = (barX + barW * f).toFixed(1);
      s += '<line class="sgrid" x1="' + gx + '" y1="' + top + '" x2="' + gx + '" y2="' + (H - top) + '"/>';
    });
    cms.forEach(function (cm, i) {
      var y = top + i * rowh;
      var w = Math.max(3, Math.round(barW * cm.multiple / max));
      var active = state.cat === cm.category;
      s += '<g class="srow' + (active ? ' active' : '') + '" data-cat="' + esc(cm.category) + '"' + catStyle(cm.category) + '>' +
        '<rect class="hit" x="0" y="' + y + '" width="' + W + '" height="' + rowh + '"/>' +
        '<text class="slabel" x="' + labelW + '" y="' + (y + base) + '" text-anchor="end">' + esc(cm.category) + '</text>' +
        '<rect class="sbar' + (cm.own ? '' : ' fb') + '" x="' + barX + '" y="' + (y + barY) + '" width="' + w + '" height="' + barH + '" rx="2"/>' +
        '<text class="sval mono" x="' + (barX + w + 7) + '" y="' + (y + base) + '">' + mult(cm.multiple) + '</text>' +
        (compact ? '' : '<text class="speers" x="' + (W - 2) + '" y="' + (y + base) + '" text-anchor="end">' + cm.peers + ' peers</text>') +
      '</g>';
    });
    return s + '</svg>';
  }

  // Implied value against TVL for every board row, log-log. The dashed line
  // is implied = TVL; dots carry their category colour, the watchlist is
  // ringed in white over the rest, and the selected protocol is royal blue.
  function scatter() {
    var W = compact ? 320 : 470, H = compact ? 232 : 218, L = 40, B = 24, T = 10, Rt = compact ? 8 : 14;
    var pw = W - L - Rt, ph = H - T - B;
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) {
      lo = Math.min(lo, r.tvl_usd, r.implied_value_usd);
      hi = Math.max(hi, r.tvl_usd, r.implied_value_usd);
    });
    lo = Math.pow(10, Math.floor(log10(lo)));
    hi = Math.pow(10, Math.ceil(log10(hi)));
    var llo = log10(lo), lhi = log10(hi);
    function X(v) { return L + pw * (log10(v) - llo) / (lhi - llo); }
    function Y(v) { return T + ph - ph * (log10(v) - llo) / (lhi - llo); }
    var s = '<svg class="scatter' + (compact ? ' compact' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Implied value against TVL, log scales">';
    for (var e = llo; e <= lhi; e++) {
      var gx = X(Math.pow(10, e)), gy = Y(Math.pow(10, e));
      var anchor = e === llo ? 'start' : e === lhi ? 'end' : 'middle';
      s += '<line class="grid" x1="' + gx.toFixed(1) + '" y1="' + T + '" x2="' + gx.toFixed(1) + '" y2="' + (T + ph) + '"/>' +
        '<line class="grid" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (L + pw) + '" y2="' + gy.toFixed(1) + '"/>' +
        '<text class="axis" x="' + gx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + tick(Math.pow(10, e)) + '</text>' +
        '<text class="axis" x="' + (L - 5) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + tick(Math.pow(10, e)) + '</text>';
    }
    s += '<line class="diag" x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '"/>' +
      '<text class="axis dim2" x="' + (L + pw - 6) + '" y="' + Y(hi * 0.3).toFixed(1) + '" text-anchor="end">implied = TVL</text>';
    rows.forEach(function (r) {
      if (r.watchlist || r.slug === state.selected) return;
      s += '<circle class="dot" data-slug="' + esc(r.slug) + '"' + catStyle(r.category || 'Uncategorized') + ' cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="' + (compact ? 3 : 2.4) + '"><title>' + esc(r.name) + '</title></circle>';
    });
    rows.forEach(function (r) {
      if (!r.watchlist || r.slug === state.selected) return;
      s += '<circle class="dot wl" data-slug="' + esc(r.slug) + '"' + catStyle(r.category || 'Uncategorized') + ' cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="' + (compact ? 3.6 : 3) + '"><title>' + esc(r.name) + ' (watchlist)</title></circle>';
    });
    var sel = bySlug[state.selected];
    if (sel) {
      s += '<circle class="dot sel" data-slug="' + esc(sel.slug) + '" cx="' + X(sel.tvl_usd).toFixed(1) + '" cy="' + Y(sel.implied_value_usd).toFixed(1) + '" r="' + (compact ? 4.6 : 4) + '"><title>' + esc(sel.name) + '</title></circle>';
    }
    return s + '</svg>';
  }

  /* ---------- static frame ---------- */
  var cats = [];
  var catSeen = {};
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    if (!catSeen[c]) { catSeen[c] = 1; cats.push(c); }
  });
  cats.sort();

  var watchCount = rows.filter(function (r) { return r.watchlist; }).length;
  var combined = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var combinedTvl = rows.reduce(function (a, r) { return a + r.tvl_usd; }, 0);
  var catCount = {};
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    catCount[c] = (catCount[c] || 0) + 1;
  });
  var topCat = Object.keys(catCount).sort(function (a, b) { return catCount[b] - catCount[a]; })[0];

  // The terminal strip: the snapshot's vital signs on one mono line,
  // hairline-separated, straight under the header.
  var stripHtml =
    '<div class="sitem"><span>Median peer multiple</span><b>' + mult(R.global_multiple) + '</b></div>' +
    '<div class="sitem"><span>Protocols covered</span><b>' + R.protocol_count + '</b></div>' +
    '<div class="sitem"><span>Combined TVL</span><b>' + money(combinedTvl) + '</b></div>' +
    '<div class="sitem"><span>Watchlist</span><b>' + watchCount + '</b></div>' +
    '<div class="sitem"><span>Top category</span><b>' + esc(topCat) + ' · ' + catCount[topCat] + '</b></div>';

  var statHtml =
    '<div class="stat"><span>Protocols scanned</span><b class="mono">' + R.protocol_count + '</b><i>snapshot of ' + esc(R.as_of) + '</i></div>' +
    '<div class="stat"><span>Ranked pre-token</span><b class="mono">' + rows.length + '</b><i>by implied value</i></div>' +
    '<div class="stat"><span>Combined implied value</span><b class="mono">' + money(combined) + '</b>' + histogram() + '</div>' +
    '<div class="stat"><span>Watchlist covered</span><b class="mono">' + watchCount + ' / ' + watchCount + '</b><i>floor ' + money(R.floor_usd) + ' TVL, no token recorded</i></div>' +
    '<div class="stat"><span>Global median mcap / TVL</span><b class="mono">' + mult(R.global_multiple) + '</b><i>' + R.global_peers + ' trading peers</i></div>';

  var multChips = R.category_multiples.map(function (cm) {
    return '<span class="mchip' + (cm.own ? ' own' : '') + '" data-cat="' + esc(cm.category) + '"' + catStyle(cm.category) + ' title="Filter the board to ' + esc(cm.category) + '"><i class="cdot"></i>' + esc(cm.category) +
      ' <b class="mono">' + mult(cm.multiple) + '</b> · ' + cm.peers + (cm.peers === 1 ? ' peer' : ' peers') + '</span>';
  }).join('');

  app.innerHTML =
    '<header class="top">' +
      '<div class="brand">' + MARK + '<div class="logo">TOKEN RADAR <span class="sub mono">v3</span></div></div>' +
      '<div class="tagline">Protocols that record no token yet, ranked by what a token would be worth if their record stayed as it is — and what to do to farm each one.</div>' +
      '<div class="snapchip mono">snapshot ' + esc(R.as_of) + ' · floor ' + money(R.floor_usd) + '</div>' +
    '</header>' +
    '<div class="strip">' + stripHtml + '</div>' +
    '<div class="stats">' + statHtml + '</div>' +
    '<section class="sector">' +
      '<div class="sectorhead"><h2><span class="idx mono">01</span>Sector multiples — the model\u2019s yardstick</h2>' +
      '<p>Protocols that already trade reveal what the market pays per dollar of TVL in their category. Each pre-token protocol is priced at the <b>median mcap/TVL of its trading peers</b>, adjusted by its seven-day TVL growth and by how long it has run with no token. <span class="dim">Nothing is scored by hand and no name is hardcoded: every figure comes from the snapshot itself. Bars in outline use the global median — their category has too few trading peers of its own. Click a sector to filter the board.</span></p></div>' +
      '<div class="charts">' +
        '<div class="chartbox"><div class="charttitle">Highest category multiples</div><div id="sectorChart">' + sectorChart() + '</div></div>' +
        '<div class="chartbox"><div class="charttitle">Implied value vs TVL — every board row, log scales</div><div id="scatter">' + scatter() + '</div>' +
        '<div class="legend"><span class="lg wl"></span> watchlist, ringed <span class="lg"></span> board protocol <span class="lg sel"></span> selected · dot colour = category</div></div>' +
      '</div>' +
      '<div class="multchips">' + multChips + '</div>' +
    '</section>' +
    '<section class="spot"><h2><span class="idx mono">02</span>Top opportunities</h2><div class="spotgrid" id="spot"></div></section>' +
    '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name, slug, category…" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="">All categories</option>' +
        cats.map(function (c) { return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select>' +
      '<label class="tgl"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count" id="count"></span>' +
      '<span class="viewswitch">' +
        '<button id="vBoard" type="button">Pre-token board</button>' +
        '<button id="vTokened" type="button">Already trading</button>' +
      '</span>' +
    '</div>' +
    '<div class="layout">' +
      '<div class="boardwrap"><div class="boardhead"><h2><span class="idx mono">03</span><span id="boardtitle"></span></h2></div><div id="board"></div></div>' +
      '<aside class="detail" id="detail"></aside>' +
    '</div>' +
    '<footer class="foot">' + MARK + '<span>An implied value is this radar\u2019s own claim, read from the snapshot\u2019s figures — not a prediction that a token will be issued, or when. A protocol is described as recording no token when the snapshot carries none for it; the record is not proof. Farm plans are starting points for your own research, sized to be affordable, and every position carries the risk its plan names.</span></footer>';

  /* ---------- spotlight ---------- */
  var spot = document.getElementById('spot');
  spot.innerHTML = rows.slice(0, 5).map(function (r) {
    var w = Math.max(4, Math.round(100 * Math.sqrt((r.implied_value_usd / r.tvl_usd) / maxRatio)));
    return '<div class="spotcard" data-slug="' + esc(r.slug) + '"' + catStyle(r.category || 'Uncategorized') + '>' +
      '<div class="rk"><span class="mono">#' + r.rank + '</span>' + tierBadge(r.rank) + '</div>' +
      '<div class="nm">' + esc(r.name) + (r.watchlist ? ' <span class="wmark" title="On the snapshot watchlist">◆</span>' : '') + '</div>' +
      '<div class="cat">' + catTag(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</div>' +
      '<div class="imp mono">' + money(r.implied_value_usd) + '</div>' +
      '<div class="bar spot-bar"><i style="width:' + w + '%"></i></div>' +
      '<div class="meta">TVL <b class="mono">' + money(r.tvl_usd) + '</b> · 7d ' + pct(r.change_7d) + ' · peers <b class="mono">' + mult(r.multiple) + '</b></div>' +
    '</div>';
  }).join('');

  /* ---------- board ---------- */
  var boardEl = document.getElementById('board');
  var countEl = document.getElementById('count');
  var titleEl = document.getElementById('boardtitle');

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    cat: function (r) { return (r.category || 'Uncategorized').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    chg: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    mult: function (r) { return r.multiple; },
    implied: function (r) { return r.implied_value_usd; },
    ratio: function (r) { return r.implied_value_usd / r.tvl_usd; },
  };
  function th(key, label, num) {
    var on = state.sort === key;
    return '<th data-sort="' + key + '"' + (num ? ' class="num"' : '') + '>' + label +
      (on ? ' <span class="arr">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '') + '</th>';
  }
  function renderBoard() {
    document.getElementById('vBoard').className = state.view === 'board' ? 'on' : '';
    document.getElementById('vTokened').className = state.view === 'tokened' ? 'on' : '';
    if (state.view === 'tokened') { renderTokened(); return; }
    titleEl.textContent = 'The board — pre-token, by implied value';
    var list = filtered();
    var key = SORTS[state.sort] || SORTS.rank;
    list = list.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      var d = (typeof x === 'string') ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      return d * state.dir || a.rank - b.rank;
    });
    countEl.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
    var html = '<table class="board"><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + th('cat', 'Category') +
      th('tvl', 'TVL', 1) + th('chg', '7d', 1) + th('mult', 'Peer ×', 1) +
      th('implied', 'Implied value', 1) + th('ratio', 'Implied / TVL', 1) +
      '</tr></thead><tbody>';
    if (!list.length) {
      html += '<tr><td colspan="8"><div class="empty">' + MARK +
        '<div>No protocols match this view. Clear the search, or pick another category.</div></div></td></tr>';
    }
    html += list.map(function (r) {
      var ratio = r.implied_value_usd / r.tvl_usd;
      var w = Math.max(3, Math.round(100 * Math.sqrt(ratio / maxRatio)));
      var cat = r.category || 'Uncategorized';
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.selected ? ' class="sel"' : '') + '>' +
        '<td class="mono">' + r.rank + '</td>' +
        '<td>' + tierBadge(r.rank) + ' <span class="pname">' + esc(r.name) + '</span>' +
          (r.watchlist ? ' <span class="wmark" title="On the snapshot watchlist">◆</span>' : '') +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + catTag(cat) + '</td>' +
        '<td class="num mono">' + money(r.tvl_usd) + '</td>' +
        '<td class="num mono">' + pct(r.change_7d) + '</td>' +
        '<td class="num mono">' + mult(r.multiple) + '</td>' +
        '<td class="num mono"><b>' + money(r.implied_value_usd) + '</b>' +
          '<div class="ibar"' + catStyle(cat) + '><i style="width:' + w + '%"></i></div></td>' +
        '<td class="num"><span class="ratio mono">' + ratio.toFixed(2) + '×</span></td>' +
      '</tr>';
    }).join('');
    boardEl.innerHTML = html + '</tbody></table>';
  }

  function renderTokened() {
    titleEl.textContent = 'Already trading — the peers the model reads from';
    countEl.textContent = R.tokened.length + ' largest shown of ' + R.tokened_count + ' trading protocols with a recorded market cap';
    var maxT = 0;
    R.tokened.forEach(function (t) { if (t.ratio > maxT) maxT = t.ratio; });
    var html = '<table class="board"><thead><tr><th>Protocol</th><th>Category</th>' +
      '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>';
    html += R.tokened.map(function (t) {
      var w = Math.max(3, Math.round(100 * Math.sqrt(t.ratio / maxT)));
      var cat = t.category || 'Uncategorized';
      return '<tr><td><span class="pname">' + esc(t.name) + '</span>' +
        (t.symbol ? ' <span class="slug">' + esc(t.symbol) + '</span>' : '') + '</td>' +
        '<td>' + catTag(cat) + '</td>' +
        '<td class="num mono">' + money(t.mcap_usd) + '</td>' +
        '<td class="num mono">' + money(t.tvl_usd) + '</td>' +
        '<td class="num"><span class="ratio mono">' + t.ratio.toFixed(2) + '×</span><div class="bar"><i style="width:' + w + '%"></i></div></td></tr>';
    }).join('');
    boardEl.innerHTML = html + '</tbody></table>' +
      '<p class="hint">These protocols already have a token that trades, so they are never ranked on the board. Their market-cap-to-TVL ratios, taken as the median per category, are what price the pre-token board.</p>';
  }

  /* ---------- detail ---------- */
  var detailEl = document.getElementById('detail');

  // TVL against implied value for one protocol, log-scaled bars.
  function vsBars(r) {
    var lo = Math.pow(10, Math.floor(Math.min(log10(r.tvl_usd), log10(r.implied_value_usd))) - 1);
    var hi = Math.max(r.tvl_usd, r.implied_value_usd) * 1.15;
    function w(v) { return Math.max(3, Math.round(100 * (log10(v) - log10(lo)) / (log10(hi) - log10(lo)))); }
    return '<div class="vsbars">' +
      '<div class="vsrow"><span>TVL</span><div class="bar wide"><i class="tvl" style="width:' + w(r.tvl_usd) + '%"></i></div><b class="mono">' + money(r.tvl_usd) + '</b></div>' +
      '<div class="vsrow"><span>Implied</span><div class="bar wide"><i style="width:' + w(r.implied_value_usd) + '%"></i></div><b class="mono">' + money(r.implied_value_usd) + '</b></div>' +
    '</div>';
  }

  // The trading peers of the protocol's category, as ratio bars in the
  // category's own colour; the dashed marker is the category median the
  // model applied.
  function peerChart(r) {
    var comps = (R.comparables[r.category || 'Uncategorized'] || []).slice()
      .sort(function (a, b) { return b.ratio - a.ratio; });
    if (!comps.length) return '';
    var shown = comps.slice(0, 8);
    var max = Math.max(comps[0].ratio, r.multiple) * 1.08;
    var W = compact ? 330 : 366, rowh = 19, headH = 14, labelW = compact ? 96 : 108, barX = labelW + 6, barW = W - barX - 46;
    var lim = compact ? 13 : 15;
    var H = headH + shown.length * rowh + 6;
    var mx = barX + Math.round(barW * r.multiple / max);
    var s = '<svg class="peerchart' + (compact ? ' compact' : '') + '"' + catStyle(r.category || 'Uncategorized') + ' viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trading peers by market cap to TVL">';
    shown.forEach(function (c, i) {
      var y = headH + 2 + i * rowh;
      var w = Math.max(3, Math.round(barW * c.ratio / max));
      s += '<text class="slabel" x="' + labelW + '" y="' + (y + 13) + '" text-anchor="end">' + esc(c.name.length > lim ? c.name.slice(0, lim - 1) + '…' : c.name) + '</text>' +
        '<rect class="pbar" x="' + barX + '" y="' + (y + 3) + '" width="' + w + '" height="11" rx="2"/>' +
        '<text class="sval mono" x="' + (barX + w + 6) + '" y="' + (y + 13) + '">' + c.ratio.toFixed(2) + '×</text>';
    });
    s += '<line class="med" x1="' + mx + '" y1="1" x2="' + mx + '" y2="' + (H - 1) + '"/>' +
      '<text class="axis" x="' + Math.max(barX - 34, Math.min(mx + 4, W - 78)) + '" y="10">median ' + mult(r.multiple) + '</text>';
    return s + '</svg>' + (comps.length > shown.length
      ? '<div class="mathnote">Top ' + shown.length + ' of ' + comps.length + ' trading peers by mcap/TVL; the median of all of them is the multiple applied.</div>' : '');
  }

  function renderDetail() {
    var r = bySlug[state.selected];
    if (!r) { detailEl.innerHTML = '<div class="hint">Select a protocol to see its model working and farm plan.</div>'; return; }
    var t = tierOf(r.rank);
    var cat = r.category || 'Uncategorized';
    var multLine = r.multiple_source === 'category'
      ? 'median of ' + r.multiple_peers + ' tokened ' + esc(cat) + ' peers'
      : 'global median of ' + r.multiple_peers + ' tokened protocols (its category has fewer than 3 trading peers)';
    var growthLine = r.change_7d === null
      ? 'seven-day change unreported'
      : 'seven-day TVL change ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
    var ageLine = r.age_days === null
      ? 'tracking date unreported'
      : 'records no token for ' + ageText(r.age_days) + (r.listed_at ? ', tracked since ' + esc(r.listed_at) : '');
    var peers = peerChart(r);
    detailEl.innerHTML =
      '<h2>' + esc(r.name) + ' ' + tierBadge(r.rank) + '</h2>' +
      '<div class="dsub mono">FILE #' + ('00' + r.rank).slice(-3) + ' · RANK ' + r.rank + ' · TIER ' + t + ' (' + tierName(t).toUpperCase() + ')' +
        (r.watchlist ? ' · ◆ ON THE SNAPSHOT WATCHLIST' : ' · BELOW THE WATCHLIST FLOOR') + '</div>' +
      '<div class="chips2">' +
        '<span class="chip2">' + catTag(cat) + '</span>' +
        r.chains.map(function (c) { return '<span class="chip2">' + esc(c) + '</span>'; }).join('') +
      '</div>' +
      '<h3>The model\u2019s working</h3>' +
      '<table class="math">' +
        '<tr><td class="k">TVL</td><td class="v mono">' + money(r.tvl_usd) + '</td></tr>' +
        '<tr><td class="k">× peer multiple</td><td class="v mono">' + mult(r.multiple) + '</td></tr>' +
        '<tr><td class="k">× growth</td><td class="v mono">' + r.growth_factor.toFixed(3) + '</td></tr>' +
        '<tr><td class="k">× age</td><td class="v mono">' + r.age_factor.toFixed(3) + '</td></tr>' +
        '<tr class="total"><td class="k">Implied value</td><td class="v mono">' + money(r.implied_value_usd) + '</td></tr>' +
      '</table>' +
      vsBars(r) +
      '<div class="mathnote">Multiple: ' + multLine + '.<br>Growth: ' + growthLine + '.<br>Age: ' + ageLine + '.</div>' +
      (peers ? '<h3>Trading peers in its category</h3>' + peers : '') +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.scrollTop = 0;
    refreshCharts();
  }

  // The scatter's selected marker and the sector chart's active row follow
  // the current state; both are cheap to redraw in place.
  function refreshCharts() {
    var sc = document.getElementById('scatter');
    if (sc) sc.innerHTML = scatter();
    var sb = document.getElementById('sectorChart');
    if (sb) sb.innerHTML = sectorChart();
  }

  /* ---------- events ---------- */
  function select(slug) {
    if (!bySlug[slug]) return;
    state.selected = slug;
    renderDetail();
    var tr = boardEl.querySelector('tr[data-slug="' + slug + '"]');
    boardEl.querySelectorAll('tr.sel').forEach(function (n) { n.classList.remove('sel'); });
    if (tr) tr.classList.add('sel');
    syncUrl();
  }
  function setCat(c) {
    state.cat = c;
    var sel = document.getElementById('cat');
    if (sel) sel.value = c;
    if (state.view !== 'board') state.view = 'board';
    renderBoard();
    refreshCharts();
    syncUrl();
  }
  spot.addEventListener('click', function (e) {
    var card = e.target.closest('[data-slug]');
    if (card) { if (state.view !== 'board') { state.view = 'board'; renderBoard(); } select(card.getAttribute('data-slug')); }
  });
  boardEl.addEventListener('click', function (e) {
    var thEl = e.target.closest('th[data-sort]');
    if (thEl) {
      var k = thEl.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = (k === 'rank' || k === 'name' || k === 'cat') ? 1 : -1; }
      renderBoard(); syncUrl(); return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) select(tr.getAttribute('data-slug'));
  });
  document.querySelector('.sector').addEventListener('click', function (e) {
    var dot = e.target.closest('[data-slug]');
    if (dot) { if (state.view !== 'board') { state.view = 'board'; renderBoard(); } select(dot.getAttribute('data-slug')); return; }
    var g = e.target.closest('[data-cat]');
    if (g) {
      var c = g.getAttribute('data-cat');
      setCat(state.cat === c ? '' : c);
      document.querySelector('.controls').scrollIntoView({ block: 'start' });
    }
  });
  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; if (state.view !== 'board') state.view = 'board'; renderBoard(); syncUrl();
  });
  document.getElementById('cat').addEventListener('change', function (e) {
    state.cat = e.target.value; if (state.view !== 'board') state.view = 'board'; renderBoard(); refreshCharts(); syncUrl();
  });
  document.getElementById('watch').addEventListener('change', function (e) {
    state.watch = e.target.checked; if (state.view !== 'board') state.view = 'board'; renderBoard(); syncUrl();
  });
  document.getElementById('vBoard').addEventListener('click', function () { state.view = 'board'; renderBoard(); syncUrl(); });
  document.getElementById('vTokened').addEventListener('click', function () { state.view = 'tokened'; renderBoard(); syncUrl(); });

  window.addEventListener('resize', function () {
    var c = window.innerWidth < 640;
    if (c !== compact) { compact = c; refreshCharts(); renderDetail(); }
  });

  renderBoard();
  renderDetail();
})();
