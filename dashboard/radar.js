// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view with the model's own arithmetic
// and the protocol's farm plan, plus the live-token tab. No network: every byte shown is in data.js.
//
// The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
// decide the action, the capital, the hold and every cost and time. No name is special-cased, and
// the page recomputes a row's implied value from the snapshot figures, so the page's code and the
// board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    watch: params.get('watch') === '1',
    tab: params.get('tab') === 'live' ? 'live' : 'board',
    sort: params.get('sort') || 'implied_value_usd',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    detail: params.get('detail') || null,
  };
  var watchSet = {};
  DATA.watchlist.forEach(function (s) { watchSet[s] = true; });
  // Watchlist membership comes from the snapshot's own list, which main.ts copies into data.js
  // verbatim — the page never re-derives it, so the filter and the board can never disagree.
  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---- formatting -------------------------------------------------------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- the model, recomputed in the page --------------------------------
  // radar-2: implied = TVL x 0.22 x growth x maturity x breadth.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var extra = Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    var breadth = 1 + extra * m.breadth_per_chain;
    return {
      growthPct: growth, growthMult: growthMult, maturity: maturity, breadth: breadth,
      implied: Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity * breadth)),
    };
  }

  // ---- the farm plan, derived the same way ------------------------------
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateralised') >= 0 || c.indexOf('collateralized') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and borrow back no more than 40% of it, so the position stays healthy while it counts as active.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' in a tight range, and keep the position in range.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' of USDC into the highest-TVL ' + name + ' vault on ' + chain + ' and leave the shares untouched.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then put the bridged funds to work in one app on the other side instead of bridging straight back.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and hold the liquid receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' (' + chain + '), open one small hedged position, and close it the same week.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' (' + chain + ') and take one small position in a market that settles within the week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('onchain capital') >= 0) return 'Allocate $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the allocation for the full hold period.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ', keeping a small buffer above the peg.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the full period.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full period.';
    if (c.indexOf('launchpad') >= 0) return "Join " + name + "'s next allocation round on " + chain + ' with $' + capital + ' and complete every task the round lists.';
    if (c.indexOf('privacy') >= 0) return 'Route one $' + capital + ' private transfer through ' + name + ' on ' + chain + ' each week and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open for the full hold period.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weekly = p.chains.length > 1 ? 'on ' + chain + ' or one of its other ' + (p.chains.length - 1) + ' chains' : 'on ' + chain;
    return [
      { text: 'Set up a fresh wallet that holds only the farming funds, write its seed phrase on paper, and never paste it anywhere.', cost: 'free, plus about $2 of gas for the first transaction', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '20 minutes to set up' },
      { text: 'Do one real action every week ' + weekly + ' — a deposit, a swap, a vote or a claim — so the wallet shows a steady pattern instead of a single burst.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days, and top it up once halfway through so the activity spans more than one snapshot window.', cost: 'the $' + capital + ' stays in the position, plus one top-up of about $' + Math.round(capital / 2), time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page weekly, and claim only from a link the protocol itself publishes — never pay anyone to claim for you.", cost: 'free to check; a claim costs gas only', time: '10 minutes a week' },
      { text: 'Log the wallet address, every date and every transaction hash in one farm log, so you can repeat the position, prove it later, or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  // ---- watchlist membership --------------------------------------------
  // The snapshot's watchlist, copied verbatim into data.js by main.ts.
  DATA.rows.forEach(function (r) { r._watch = !!watchSet[r.slug]; });

  // ---- controls ----------------------------------------------------------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watch');
  var countEl = document.getElementById('count');
  var rowsEl = document.getElementById('rows');
  var emptyEl = document.getElementById('empty');
  var detailEl = document.getElementById('detail');
  var tabsEl = document.getElementById('tabs');

  var cats = {};
  var chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  qEl.value = state.q;
  catEl.value = state.cat;
  chainEl.value = state.chain;
  watchEl.checked = state.watch;

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.detail) p.set('detail', state.detail);
    if (state.sort !== 'implied_value_usd') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', 'asc');
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = state.tab === 'live' ? DATA.live.slice() : DATA.rows.slice();
    return list.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && state.tab === 'board' && !r._watch) return false;
      return true;
    });
  }

  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    function val(r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'category') return (r.category || '').toLowerCase();
      if (key === 'rank') return r.rank == null ? 1e9 : r.rank;
      var v = r[key];
      return v === null || v === undefined ? -Infinity : v;
    }
    return list.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderStats() {
    var top = DATA.rows[0];
    document.getElementById('stats').innerHTML =
      '<div><dt>Protocols</dt><dd>' + DATA.board_size + '</dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + '</dd></div>' +
      '<div><dt>Early finds</dt><dd>' + DATA.early_size + '</dd></div>' +
      '<div><dt>Top implied</dt><dd>' + fmtUsd(top ? top.implied_value_usd : 0) + '</dd></div>';
    document.getElementById('foot').textContent =
      'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Model ' + DATA.model_version +
      ' · Implied values are this radar’s own claim, not a prediction. No network was used to render this page.';
  }

  function renderTable() {
    var list = sortRows(filtered());
    var live = state.tab === 'live';
    countEl.textContent = list.length + ' of ' + (live ? DATA.live_size : DATA.board_size) + ' shown';
    emptyEl.hidden = list.length > 0;
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
      var base = th.textContent.replace(/ [▲▼]$/, '');
      th.textContent = base + (th.getAttribute('data-sort') === state.sort ? (state.dir === -1 ? ' ▼' : ' ▲') : '');
    });
    rowsEl.innerHTML = list.map(function (r) {
      var chg = r.change_7d;
      var chgCls = chg === null ? '' : chg >= 0 ? 'up' : 'down';
      var main = live
        ? '<td class="value">' + fmtUsd(r.mcap_usd) + '</td>'
        : '<td class="value">' + fmtUsd(r.implied_value_usd) + '</td>';
      var rankCell = live ? '<td class="num">—</td>' : '<td class="num">' + r.rank + '</td>';
      var ageCell = live ? '<td class="num">—</td>' : '<td class="num">' + fmtAge(r.age_days) + '</td>';
      var watchPill = (!live && r._watch) ? ' <span class="pill watch">watchlist</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        rankCell +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="slug">' + esc(r.slug) + '</span>' + watchPill + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td><span class="pill">' + esc(r.chains[0] || '—') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + fmtPct(chg) + '</td>' +
        ageCell + main + '</tr>';
    }).join('');
    if (live) document.querySelector('#board th[data-sort="implied_value_usd"]').textContent = 'Market cap';
    else document.querySelector('#board th[data-sort="implied_value_usd"]').textContent = 'Implied value';
  }

  function renderDetail() {
    var r = state.detail ? bySlug[state.detail] : null;
    if (!r || state.tab === 'live') { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var calc = impliedOf(r);
    var base = Math.round(r.tvl_usd * DATA.model.base_multiple);
    var steps = farmSteps(r);
    detailEl.innerHTML =
      '<button type="button" class="close" id="closeDetail">Close ×</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · listed ' + esc(r.listed_at || 'date unknown') + ' · records no token' + (r._watch ? ' · on the watchlist' : '') + '</p>' +
      '<h3>Why this value — the model, step by step</h3>' +
      '<div class="math">' +
      '<span class="term"><b>' + fmtUsd(base) + '</b><span>TVL × 0.22</span></span><span class="op">×</span>' +
      '<span class="term"><b>' + calc.growthMult.toFixed(2) + '</b><span>growth ' + fmtPct(calc.growthPct) + '</span></span><span class="op">×</span>' +
      '<span class="term"><b>' + calc.maturity.toFixed(2) + '</b><span>maturity ' + fmtAge(r.age_days) + '</span></span><span class="op">×</span>' +
      '<span class="term"><b>' + calc.breadth.toFixed(2) + '</b><span>breadth ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span></span><span class="op">=</span>' +
      '<span class="term"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></span>' +
      '</div>' +
      '<p class="sub">The page recomputes ' + fmtUsd(calc.implied) + ' from the snapshot figures; board.json carries ' + fmtUsd(r.implied_value_usd) + '.</p>' +
      '<h3>Farm plan — six steps, with cost and time</h3>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    document.getElementById('closeDetail').addEventListener('click', function () {
      state.detail = null; syncUrl(); renderTable(); renderDetail();
    });
  }

  function render() {
    tabsEl.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab);
    });
    document.getElementById('controls').style.display = state.tab === 'live' ? 'none' : 'flex';
    renderStats();
    renderTable();
    renderDetail();
  }

  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.getAttribute('data-tab');
    if (state.tab === 'live') state.detail = null;
    syncUrl(); render();
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      syncUrl(); renderTable();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr || state.tab === 'live') return;
    state.detail = tr.getAttribute('data-slug');
    syncUrl(); renderTable(); renderDetail();
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  var deb;
  qEl.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.q = qEl.value; syncUrl(); renderTable(); }, 120);
  });
  catEl.addEventListener('change', function () { state.cat = catEl.value; syncUrl(); renderTable(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; syncUrl(); renderTable(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; syncUrl(); renderTable(); });

  render();
})();
