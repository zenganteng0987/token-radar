// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters and a detail view with
// the model's working and the farm plan for each protocol. No network.
(function () {
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v;
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  var state = { q: '', category: '', chain: '', watchOnly: false, sort: 'rank', dir: 1, selected: DATA.rows.length ? DATA.rows[0].slug : null };

  // A view can be named in the address (?select=<slug>&category=<name>&watch=1),
  // so a link can open the board already filtered or on a protocol's detail.
  var params = new URLSearchParams(window.location.search);
  if (params.get('q')) state.q = params.get('q').toLowerCase();
  if (params.get('category')) state.category = params.get('category');
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('watch') === '1') state.watchOnly = true;
  if (params.get('select')) state.selected = params.get('select');

  // ---------- header ----------
  var header = el('header', 'top');
  var logo = el('div', 'logo');
  logo.appendChild(document.createTextNode('TOKEN RADAR'));
  var dot = el('span', 'dot', ' ●');
  logo.appendChild(dot);
  header.appendChild(logo);
  header.appendChild(el('div', 'tagline', 'Pre-token protocols ranked by implied value — what a token would be worth if the record stayed as it is, and how to farm each one before it issues.'));
  app.appendChild(header);

  var chips = el('div', 'chips');
  function chip(label, value, hot) {
    var c = el('span', 'chip' + (hot ? ' hot' : ''));
    c.appendChild(document.createTextNode(label + ' '));
    c.appendChild(el('b', null, value));
    return c;
  }
  var watchCount = DATA.rows.filter(function (r) { return r.watchlist; }).length;
  chips.appendChild(chip('Snapshot', DATA.as_of));
  chips.appendChild(chip('Protocols scanned', DATA.rows.length + ' on board'));
  chips.appendChild(chip('Watchlist (TVL ≥ ' + money(DATA.floor_usd) + ', no token)', watchCount + ' covered', true));
  chips.appendChild(chip('Global median value / TVL', DATA.global_multiple.toFixed(2) + '×'));
  app.appendChild(chips);

  var model = el('div', 'model');
  model.appendChild(el('b', null, 'The model. '));
  model.appendChild(document.createTextNode('Protocols that already trade a token show what the market pays per dollar of TVL in each category. The radar prices every pre-token protocol at its own category\'s median multiple, then adjusts for the two other facts the snapshot carries: seven-day TVL momentum and how long the protocol has run with no token. The board is screened with the watchlist\'s own rule at every TVL: wrapped, staked or bridged products of tokens that already trade, and exchanges themselves, are not launches and are never ranked. '));
  var f = el('span', 'formula mono', 'implied value = TVL × category multiple × growth factor × age factor');
  model.appendChild(f);
  model.appendChild(document.createTextNode(' Protocols that already have a token are never ranked; they appear only as comparables in the detail view.'));
  app.appendChild(model);

  // ---------- controls ----------
  var controls = el('div', 'controls');
  var search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search protocol or category…';
  search.value = state.q;
  search.addEventListener('input', function () { state.q = search.value.trim().toLowerCase(); render(); });
  controls.appendChild(search);

  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    if (categories.indexOf(c) < 0) categories.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  categories.sort(); chains.sort();

  function select(options, allLabel, onChange, initial) {
    var s = document.createElement('select');
    var first = document.createElement('option');
    first.value = ''; first.textContent = allLabel;
    s.appendChild(first);
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o; op.textContent = o;
      if (o === initial) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', function () { onChange(s.value); render(); });
    return s;
  }
  controls.appendChild(select(categories, 'All categories', function (v) { state.category = v; }, state.category));
  controls.appendChild(select(chains, 'All chains', function (v) { state.chain = v; }, state.chain));

  var checkLabel = el('label', 'check');
  var check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = state.watchOnly;
  check.addEventListener('change', function () { state.watchOnly = check.checked; render(); });
  checkLabel.appendChild(check);
  checkLabel.appendChild(document.createTextNode('Watchlist only'));
  controls.appendChild(checkLabel);

  var count = el('span', 'count');
  controls.appendChild(count);
  app.appendChild(controls);

  // ---------- layout ----------
  var layout = el('div', 'layout');
  var boardwrap = el('div', 'boardwrap');
  var table = document.createElement('table');
  boardwrap.appendChild(table);
  layout.appendChild(boardwrap);
  var aside = el('aside', 'detail');
  layout.appendChild(aside);
  app.appendChild(layout);

  var footer = el('footer', null,
    'Implied values are this board\'s own claim, computed from the snapshot\'s figures alone — not a prediction that a token will be issued or what it would trade at. ' +
    'Farm plans describe ordinary use of each protocol with your own wallet; they are not financial advice. Data: DefiLlama snapshot of ' + DATA.as_of + ', sealed for this competition.');
  app.appendChild(footer);

  var COLUMNS = [
    { key: 'rank', label: 'Rank', num: true },
    { key: 'name', label: 'Protocol' },
    { key: 'category', label: 'Category' },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true },
    { key: 'ratio', label: 'Value / TVL', num: true }
  ];

  function filtered() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'ratio') { va = a.implied_value_usd / a.tvl_usd; vb = b.implied_value_usd / b.tvl_usd; }
      else if (key === 'name' || key === 'category') {
        va = (a[key] || ''); vb = (b[key] || '');
        return state.dir * (va < vb ? -1 : va > vb ? 1 : 0);
      } else { va = a[key] || 0; vb = b[key] || 0; }
      return state.dir * (va - vb);
    });
    return rows;
  }

  function renderDetail(row) {
    aside.textContent = '';
    if (!row) { aside.appendChild(el('div', 'empty', 'Select a protocol on the board to see its detail and farm plan.')); return; }
    aside.appendChild(el('h2', null, row.name));
    aside.appendChild(el('div', 'sub', 'Rank #' + row.rank + ' · ' + (row.category || 'Uncategorized') + (row.watchlist ? ' · on the watchlist' : ' · below the $50M watchlist floor')));
    var kv = el('div', 'kv');
    function pair(k, v, cls) {
      kv.appendChild(el('span', 'k', k));
      kv.appendChild(el('span', 'v mono ' + (cls || ''), v));
    }
    pair('TVL', money(row.tvl_usd));
    pair('TVL change, 7 days', pct(row.change_7d), row.change_7d === null ? '' : (row.change_7d >= 0 ? 'pos' : 'neg'));
    pair('Chains', row.chains.slice(0, 3).join(', ') || '—');
    pair('Tracked since', row.listed_at ? row.listed_at + ' (' + row.age_days + ' days, no token yet)' : '—');
    pair('Implied value', money(row.implied_value_usd), 'implied');
    aside.appendChild(kv);

    var bd = el('div', 'breakdown');
    bd.appendChild(el('b', null, 'How the value is built'));
    bd.appendChild(document.createElement('br'));
    var line = el('span', 'formula mono',
      money(row.tvl_usd) + ' × ' + row.multiple.toFixed(2) + ' (' + (row.multiple_source === 'category' ? 'category' : 'global') + ') × ' + row.growth_factor.toFixed(2) + ' (7d growth) × ' + row.age_factor.toFixed(2) + ' (age) = ' + money(row.implied_value_usd));
    bd.appendChild(line);
    if (row.multiple_source !== 'category') {
      bd.appendChild(document.createElement('br'));
      bd.appendChild(document.createTextNode('The global median speaks for this category: fewer than three of its protocols trade a token in the snapshot.'));
    }
    aside.appendChild(bd);

    var comps = (DATA.comparables[row.category || 'Uncategorized'] || []);
    aside.appendChild(el('h3', null, 'Tokened peers in this category'));
    if (comps.length) {
      comps.forEach(function (c) {
        var line2 = el('div', 'comp');
        line2.appendChild(el('b', null, c.name));
        line2.appendChild(document.createTextNode(' — market cap ' + money(c.mcap_usd) + ' on ' + money(c.tvl_usd) + ' TVL (' + c.ratio.toFixed(2) + '×)'));
        aside.appendChild(line2);
      });
    } else {
      aside.appendChild(el('div', 'comp', 'No tokened peer in this category in the snapshot; the global median multiple applies.'));
    }

    aside.appendChild(el('h3', null, 'Farm plan'));
    var ol = document.createElement('ol');
    ol.className = 'steps';
    row.farm_steps.forEach(function (s) {
      ol.appendChild(el('li', null, s));
    });
    aside.appendChild(ol);
  }

  function render() {
    var rows = filtered();
    count.textContent = rows.length + ' of ' + DATA.rows.length + ' protocols shown';
    table.textContent = '';
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    COLUMNS.forEach(function (col) {
      var th = el('th', (col.num ? 'num ' : '') + (state.sort === col.key ? 'sorted' : ''), col.label + (state.sort === col.key ? (state.dir === 1 ? ' ↑' : ' ↓') : ''));
      th.addEventListener('click', function () {
        if (state.sort === col.key) state.dir = -state.dir;
        else { state.sort = col.key; state.dir = col.key === 'name' || col.key === 'category' ? 1 : -1; if (col.key === 'rank') state.dir = 1; }
        render();
      });
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.slice(0, 400).forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.slug === state.selected) tr.className = 'selected';
      tr.addEventListener('click', function () { state.selected = r.slug; render(); });
      var tdRank = el('td', 'rank mono', '#' + r.rank);
      var tdName = el('td', 'name');
      if (r.watchlist) tdName.appendChild(el('span', 'wdot'));
      tdName.appendChild(document.createTextNode(r.name));
      var tdCat = el('td', 'cat', r.category || 'Uncategorized');
      var tdTvl = el('td', 'num mono', money(r.tvl_usd));
      var tdChg = el('td', 'num mono ' + (r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')), pct(r.change_7d));
      var tdImp = el('td', 'num mono implied', money(r.implied_value_usd));
      var tdRatio = el('td', 'num mono', (r.implied_value_usd / r.tvl_usd).toFixed(2) + '×');
      [tdRank, tdName, tdCat, tdTvl, tdChg, tdImp, tdRatio].forEach(function (td) { tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var sel = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { sel = DATA.rows[i]; break; }
    renderDetail(sel);
  }

  render();
})();
