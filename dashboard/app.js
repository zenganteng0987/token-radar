// Token Radar v2 dashboard. Renders window.RADAR (written beside dashboard/
// by main.ts): a ranked board of pre-token protocols with the value model's
// working shown per protocol, category farm playbooks, a spotlight of the
// top opportunities, and the already-trading peers the model reads from.
// Static page, no network. A view can be named in the address:
// ?select=<slug>&cat=<category>&watch=1&q=<text>&view=tokened&sort=<key>
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !app) return;
  var rows = R.rows;

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
  function pct(v) {
    if (v === null || v === undefined) return '<span class="ratio">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
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

  /* ---------- static frame ---------- */
  var cats = [];
  var catSeen = {};
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    if (!catSeen[c]) { catSeen[c] = 1; cats.push(c); }
  });
  cats.sort();

  var statHtml =
    '<div class="stat"><b class="mono">' + R.protocol_count + '</b><span>protocols scanned</span></div>' +
    '<div class="stat"><b class="mono">' + rows.filter(function (r) { return r.watchlist; }).length + '</b><span>on the watchlist</span></div>' +
    '<div class="stat"><b class="mono">' + rows.length + '</b><span>ranked pre-token</span></div>' +
    '<div class="stat"><b class="mono">' + R.trading_count + '</b><span>already trading</span></div>' +
    '<div class="stat"><b class="mono">' + mult(R.global_multiple) + '</b><span>global median mcap/TVL</span></div>';

  var multChips = R.category_multiples.map(function (cm) {
    return '<span class="mchip' + (cm.own ? ' own' : '') + '">' + esc(cm.category) +
      ' <b class="mono">' + mult(cm.multiple) + '</b> · ' + cm.peers + (cm.peers === 1 ? ' peer' : ' peers') + '</span>';
  }).join('');

  app.innerHTML =
    '<header class="top">' +
      '<div class="logo">TOKEN<span class="dot">·</span>RADAR <span class="sub">v2</span></div>' +
      '<div class="tagline">Protocols that record no token yet, ranked by what a token would be worth if their record stayed as it is — and what to do to farm each one. Snapshot of ' + esc(R.as_of) + ', floor ' + money(R.floor_usd) + '.</div>' +
    '</header>' +
    '<div class="stats">' + statHtml + '</div>' +
    '<section class="model"><h2>How the implied value is read</h2>' +
      '<p>Protocols that already trade reveal what the market pays per dollar of TVL in their category. Each pre-token protocol is priced at the <b>median mcap/TVL of its trading peers</b>, adjusted by its seven-day TVL growth and by how long it has run with no token. <span class="dim">Nothing is scored by hand and no name is hardcoded: every figure comes from the snapshot itself. Open any protocol to see its arithmetic in full.</span></p>' +
      '<div class="multchips">' + multChips + '</div>' +
    '</section>' +
    '<section class="spot"><h2>Top opportunities</h2><div class="spotgrid" id="spot"></div></section>' +
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
      '<div class="boardwrap"><div class="boardhead"><h2 id="boardtitle"></h2></div><div id="board"></div></div>' +
      '<aside class="detail" id="detail"></aside>' +
    '</div>' +
    '<footer class="foot">An implied value is this radar\'s own claim, read from the snapshot\'s figures — not a prediction that a token will be issued, or when. A protocol is described as recording no token when the snapshot carries none for it; the record is not proof. Farm plans are starting points for your own research, sized to be affordable, and every position carries the risk its plan names.</footer>';

  /* ---------- spotlight ---------- */
  var spot = document.getElementById('spot');
  spot.innerHTML = rows.slice(0, 5).map(function (r) {
    return '<div class="spotcard" data-slug="' + esc(r.slug) + '">' +
      '<div class="rk"><span class="mono">#' + r.rank + '</span>' + tierBadge(r.rank) + '</div>' +
      '<div class="nm">' + esc(r.name) + (r.watchlist ? ' <span class="wmark" title="On the snapshot watchlist">◆</span>' : '') + '</div>' +
      '<div class="cat">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</div>' +
      '<div class="imp mono">' + money(r.implied_value_usd) + '</div>' +
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
    html += list.map(function (r) {
      var ratio = r.implied_value_usd / r.tvl_usd;
      var w = Math.max(3, Math.round(100 * Math.sqrt(ratio / maxRatio)));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.selected ? ' class="sel"' : '') + '>' +
        '<td class="mono">' + r.rank + '</td>' +
        '<td>' + tierBadge(r.rank) + ' <span class="pname">' + esc(r.name) + '</span>' +
          (r.watchlist ? ' <span class="wmark" title="On the snapshot watchlist">◆</span>' : '') +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td class="num mono">' + money(r.tvl_usd) + '</td>' +
        '<td class="num mono">' + pct(r.change_7d) + '</td>' +
        '<td class="num mono">' + mult(r.multiple) + '</td>' +
        '<td class="num mono"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num"><span class="ratio mono">' + ratio.toFixed(2) + '×</span><div class="bar"><i style="width:' + w + '%"></i></div></td>' +
      '</tr>';
    }).join('');
    boardEl.innerHTML = html + '</tbody></table>';
  }

  function renderTokened() {
    titleEl.textContent = 'Already trading — the peers the model reads from';
    countEl.textContent = R.tokened.length + ' largest shown of ' + R.tokened_count + ' trading protocols with a recorded market cap';
    var html = '<table class="board"><thead><tr><th>Protocol</th><th>Category</th>' +
      '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>';
    html += R.tokened.map(function (t) {
      return '<tr><td><span class="pname">' + esc(t.name) + '</span>' +
        (t.symbol ? ' <span class="slug">' + esc(t.symbol) + '</span>' : '') + '</td>' +
        '<td>' + esc(t.category || 'Uncategorized') + '</td>' +
        '<td class="num mono">' + money(t.mcap_usd) + '</td>' +
        '<td class="num mono">' + money(t.tvl_usd) + '</td>' +
        '<td class="num mono">' + t.ratio.toFixed(2) + '×</td></tr>';
    }).join('');
    boardEl.innerHTML = html + '</tbody></table>' +
      '<p class="hint">These protocols already have a token that trades, so they are never ranked on the board. Their market-cap-to-TVL ratios, taken as the median per category, are what price the pre-token board.</p>';
  }

  /* ---------- detail ---------- */
  var detailEl = document.getElementById('detail');
  function renderDetail() {
    var r = bySlug[state.selected];
    if (!r) { detailEl.innerHTML = '<div class="hint">Select a protocol to see its model working and farm plan.</div>'; return; }
    var t = tierOf(r.rank);
    var multLine = r.multiple_source === 'category'
      ? 'median of ' + r.multiple_peers + ' tokened ' + esc(r.category || '') + ' peers'
      : 'global median of ' + r.multiple_peers + ' tokened protocols (its category has fewer than 3 trading peers)';
    var growthLine = r.change_7d === null
      ? 'seven-day change unreported'
      : 'seven-day TVL change ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
    var ageLine = r.age_days === null
      ? 'tracking date unreported'
      : 'records no token for ' + ageText(r.age_days) + (r.listed_at ? ', tracked since ' + esc(r.listed_at) : '');
    var comps = (R.comparables[r.category || 'Uncategorized'] || []).map(function (c) {
      return '<div><b>' + esc(c.name) + '</b> — mcap ' + money(c.mcap_usd) + ' on TVL ' + money(c.tvl_usd) + ' = <span class="mono">' + c.ratio.toFixed(2) + '×</span></div>';
    }).join('');
    detailEl.innerHTML =
      '<h2>' + esc(r.name) + ' ' + tierBadge(r.rank) + '</h2>' +
      '<div class="dsub">Rank #' + r.rank + ' · Tier ' + t + ' (' + tierName(t) + ')' +
        (r.watchlist ? ' · <span class="wmark">◆</span> on the snapshot watchlist' : ' · below the watchlist floor, found by the radar') + '</div>' +
      '<div class="chips2">' +
        '<span class="chip2">' + esc(r.category || 'Uncategorized') + '</span>' +
        r.chains.map(function (c) { return '<span class="chip2">' + esc(c) + '</span>'; }).join('') +
      '</div>' +
      '<h3>The model\'s working</h3>' +
      '<table class="math">' +
        '<tr><td class="k">TVL</td><td class="v mono">' + money(r.tvl_usd) + '</td></tr>' +
        '<tr><td class="k">× peer multiple</td><td class="v mono">' + mult(r.multiple) + '</td></tr>' +
        '<tr><td class="k">× growth</td><td class="v mono">' + r.growth_factor.toFixed(3) + '</td></tr>' +
        '<tr><td class="k">× age</td><td class="v mono">' + r.age_factor.toFixed(3) + '</td></tr>' +
        '<tr class="total"><td class="k">Implied value</td><td class="v mono">' + money(r.implied_value_usd) + '</td></tr>' +
      '</table>' +
      '<div class="mathnote">Multiple: ' + multLine + '.<br>Growth: ' + growthLine + '.<br>Age: ' + ageLine + '.</div>' +
      (comps ? '<h3>Trading peers in its category</h3><div class="comp">' + comps + '</div>' : '') +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.scrollTop = 0;
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
  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; if (state.view !== 'board') state.view = 'board'; renderBoard(); syncUrl();
  });
  document.getElementById('cat').addEventListener('change', function (e) {
    state.cat = e.target.value; if (state.view !== 'board') state.view = 'board'; renderBoard(); syncUrl();
  });
  document.getElementById('watch').addEventListener('change', function (e) {
    state.watch = e.target.checked; if (state.view !== 'board') state.view = 'board'; renderBoard(); syncUrl();
  });
  document.getElementById('vBoard').addEventListener('click', function () { state.view = 'board'; renderBoard(); syncUrl(); });
  document.getElementById('vTokened').addEventListener('click', function () { state.view = 'tokened'; renderBoard(); syncUrl(); });

  renderBoard();
  renderDetail();
})();
