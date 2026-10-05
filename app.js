'use strict';

/* =========================================================
   Durdy Grocery: all data lives in localStorage on the phone.
   ========================================================= */

const STORE_KEY = 'durdy-grocery';
const DEFAULT_SECTIONS = [
  'Produce', 'Meat & Seafood', 'Deli', 'Bakery', 'Dairy & Eggs', 'Frozen',
  'Pantry/Dry Goods', 'Snacks', 'Beverages', 'Household', 'Other',
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUICK_NOTES = ['Leftovers', 'Eat out', 'Pizza night'];

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = (o) => JSON.parse(JSON.stringify(o));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const weekStartOf = (date = new Date()) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return ymd(d);
};
const fmtDay = (s) => { const d = parseYmd(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const fmtWeek = (ws) => {
  const a = parseYmd(ws), b = parseYmd(addDays(ws, 6));
  return a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}`
    : `${fmtDay(ws)} – ${fmtDay(addDays(ws, 6))}`;
};

/* ---------- quantities & units ---------- */
const FRACTION_CHARS = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125 };

// Returns a number, null for blank, or NaN for text like "a few".
function parseQty(q) {
  let s = String(q ?? '').trim();
  if (!s) return null;
  let total = 0;
  s = s.replace(/[½¼¾⅓⅔⅛]/g, (c) => { total += FRACTION_CHARS[c]; return ' '; }).trim();
  if (!s) return total;
  const parts = s.split(/\s+/);
  for (const p of parts) {
    if (/^\d+\/\d+$/.test(p)) { const [a, b] = p.split('/').map(Number); if (!b) return NaN; total += a / b; }
    else if (/^\d*\.?\d+$/.test(p)) total += parseFloat(p);
    else return NaN;
  }
  return total;
}

function fmtQty(n) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const fracs = [[0, ''], [.25, '¼'], [1 / 3, '⅓'], [.5, '½'], [2 / 3, '⅔'], [.75, '¾'], [1, '']];
  for (const [v, ch] of fracs) {
    if (Math.abs(frac - v) < .03) {
      const w = v === 1 ? whole + 1 : whole;
      return ch ? (w ? `${w}${ch}` : ch) : String(w);
    }
  }
  return String(Math.round(n * 100) / 100);
}

const UNIT_ALIASES = {
  lbs: 'lb', pound: 'lb', pounds: 'lb', '#': 'lb',
  ounce: 'oz', ounces: 'oz',
  package: 'pkg', packages: 'pkg', pkgs: 'pkg', pack: 'pkg', packs: 'pkg',
  boxes: 'box', bunches: 'bunch', loaves: 'loaf', pouches: 'pouch',
  gallon: 'gal', gallons: 'gal', gals: 'gal',
  tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
  doz: 'dozen', dozens: 'dozen', ea: '', each: '', ct: '', count: '',
};
function normUnit(u) {
  let s = String(u ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (s in UNIT_ALIASES) return UNIT_ALIASES[s];
  if (s.length > 2 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}
const PLURAL_UNITS = { box: 'boxes', bunch: 'bunches', loaf: 'loaves', pouch: 'pouches' };
const NO_PLURAL = new Set(['lb', 'oz', 'pkg', 'gal', 'tbsp', 'tsp', 'dozen', 'qt', 'pt', 'ml', 'l', 'g', 'kg']);
function unitLabel(u, n) {
  if (!u || n <= 1 || NO_PLURAL.has(u)) return u;
  return PLURAL_UNITS[u] || u + 's';
}

// Key used to merge duplicates: case/space-insensitive, simple plural folding.
function nameKey(name) {
  let s = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

/* ---------- state ---------- */
function blankWeek() { return { dinner: Array(7).fill(''), lunch: Array(7).fill('') }; }

function blankState() {
  return {
    v: 1,
    sections: [...DEFAULT_SECTIONS],
    meals: [],
    staples: [],
    weeks: {},
    week: weekStartOf(),
    manual: [],
    checked: {},
    have: {},
    showLunch: false,
    theme: 'auto',
  };
}

function seedState() {
  const s = blankState();
  const ing = (name, qty, unit, section) => ({ name, qty, unit, section });
  const P = 'Produce', M = 'Meat & Seafood', D = 'Dairy & Eggs', B = 'Bakery', F = 'Frozen', DRY = 'Pantry/Dry Goods';
  s.meals = [
    { id: uid(), name: 'Burrito Bowls', notes: 'Warm rice + beans, top with everything. Kids build their own.', ingredients: [
      ing('Rice', '2', 'cup', DRY), ing('Black beans', '2', 'can', DRY), ing('Chicken breast', '2', 'lb', M),
      ing('Taco seasoning', '1', 'packet', DRY), ing('Salsa', '1', 'jar', DRY), ing('Shredded cheese', '1', 'bag', D),
      ing('Sour cream', '1', 'tub', D), ing('Romaine lettuce', '1', 'head', P), ing('Frozen corn', '1', 'bag', F), ing('Limes', '2', '', P),
    ] },
    { id: uid(), name: 'Spaghetti', notes: '', ingredients: [
      ing('Spaghetti noodles', '2', 'lb', DRY), ing('Ground beef', '1.5', 'lb', M), ing('Marinara sauce', '2', 'jar', DRY),
      ing('Parmesan cheese', '1', 'container', D), ing('Frozen garlic bread', '1', 'box', F), ing('Bagged salad', '1', 'bag', P),
    ] },
    { id: uid(), name: 'Tacos', notes: 'Hard and soft shells.', ingredients: [
      ing('Ground beef', '2', 'lb', M), ing('Taco seasoning', '2', 'packet', DRY), ing('Taco shells', '1', 'box', DRY),
      ing('Flour tortillas', '1', 'pkg', DRY), ing('Shredded cheese', '1', 'bag', D), ing('Sour cream', '1', 'tub', D),
      ing('Romaine lettuce', '1', 'head', P), ing('Tomatoes', '2', '', P), ing('Salsa', '1', 'jar', DRY),
    ] },
    { id: uid(), name: 'Breakfast for Dinner', notes: '', ingredients: [
      ing('Pancake mix', '1', 'box', DRY), ing('Bacon', '1', 'pkg', M), ing('Eggs', '1', 'dozen', D),
      ing('Maple syrup', '1', 'bottle', DRY), ing('Strawberries', '1', 'lb', P),
    ] },
    { id: uid(), name: 'Turkey Sandwiches', notes: 'Lunch', ingredients: [
      ing('Sliced turkey', '1', 'lb', 'Deli'), ing('Sliced cheese', '1', 'pkg', 'Deli'), ing('Sandwich bread', '1', 'loaf', B), ing('Apples', '5', '', P),
    ] },
  ];
  const st = (name, section, qty = '', unit = '') => ({ id: uid(), name, section, qty, unit, status: '' });
  s.staples = [
    st('Bananas', P, '2', 'bunch'), st('Apples', P, '6'), st('Grapes', P, '1', 'bag'), st('Baby carrots', P, '1', 'bag'),
    st('Lunch meat', 'Deli'), st('Sliced cheese', 'Deli'),
    st('Sandwich bread', B, '2', 'loaf'),
    st('Milk', D, '2', 'gal'), st('Eggs', D, '2', 'dozen'), st('Butter', D), st('Yogurt', D), st('Cheese sticks', D),
    st('Frozen waffles', F), st('Chicken nuggets', F),
    st('Cereal', DRY, '2', 'box'), st('Peanut butter', DRY), st('Jelly', DRY),
    st('Goldfish crackers', 'Snacks'), st('Granola bars', 'Snacks'), st('Chips', 'Snacks'),
    st('Coffee', 'Beverages'), st('Juice boxes', 'Beverages'),
    st('Paper towels', 'Household'), st('Toilet paper', 'Household'), st('Dish soap', 'Household'), st('Trash bags', 'Household'),
  ];
  // A starter plan so the list isn't empty on first open.
  const w = blankWeek();
  w.dinner[1] = s.meals[2].id; // Mon: Tacos
  w.dinner[3] = s.meals[1].id; // Wed: Spaghetti
  w.dinner[5] = s.meals[0].id; // Fri: Burrito Bowls
  s.weeks[s.week] = w;
  s.staples.find((x) => x.name === 'Milk').status = 'need';
  s.staples.find((x) => x.name === 'Bananas').status = 'need';
  s.staples.find((x) => x.name === 'Coffee').status = 'low';
  return s;
}

function normalizeState(raw) {
  const s = Object.assign(blankState(), raw);
  if (!Array.isArray(s.sections) || !s.sections.length) s.sections = [...DEFAULT_SECTIONS];
  s.meals = (s.meals || []).map((m) => ({ id: m.id || uid(), name: m.name || 'Untitled', notes: m.notes || '', ingredients: Array.isArray(m.ingredients) ? m.ingredients : [] }));
  s.staples = (s.staples || []).map((x) => ({ id: x.id || uid(), name: x.name || '', section: x.section || 'Other', qty: x.qty || '', unit: x.unit || '', status: x.status || '' }));
  s.manual = Array.isArray(s.manual) ? s.manual : [];
  s.checked = s.checked || {};
  s.have = s.have || {};
  s.weeks = s.weeks || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.week || '')) s.week = weekStartOf();
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data', e); }
  return seedState();
}

let state = loadState();

function save() {
  // Keep about 6 months of plans so storage stays small.
  const cutoff = addDays(weekStartOf(), -26 * 7);
  for (const k of Object.keys(state.weeks)) if (k < cutoff) delete state.weeks[k];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save. Storage may be full.'); }
}

function commit() { save(); render(); }

/* ---------- derived data ---------- */
const mealById = (id) => state.meals.find((m) => m.id === id);
const getWeek = (ws) => state.weeks[ws] || blankWeek();
function ensureWeek(ws) { if (!state.weeks[ws]) state.weeks[ws] = blankWeek(); return state.weeks[ws]; }
function slotLabel(v) {
  if (!v) return '';
  if (v.startsWith('text:')) return v.slice(5);
  return mealById(v)?.name || '';
}
function sectionOrder() {
  const order = [...state.sections];
  if (!order.includes('Other')) order.push('Other');
  return order;
}
function validSection(sec) { return state.sections.includes(sec) ? sec : 'Other'; }

function knownItems() {
  const map = new Map();
  for (const m of state.meals) for (const i of m.ingredients) if (i.name) map.set(nameKey(i.name), { name: i.name, section: i.section });
  for (const s of state.staples) if (s.name) map.set(nameKey(s.name), { name: s.name, section: s.section });
  return map;
}
// Fallback section guesses for items the app hasn't seen before. Longest matching phrase wins,
// so "peanut butter" beats "butter" and "frozen pizza" beats "pizza".
const SECTION_WORDS = {
  'Produce': 'apple,banana,orange,grape,berries,berry,lemon,lime,avocado,lettuce,romaine,spinach,kale,salad,tomato,potato,onion,garlic,bell pepper,carrot,celery,cucumber,broccoli,cauliflower,zucchini,squash,mushroom,peach,pear,plum,melon,cilantro,parsley,basil,mango,pineapple,kiwi,cabbage,asparagus,green beans,fruit,veggie,jalapeno',
  'Meat & Seafood': 'beef,chicken,pork,turkey,steak,sausage,bacon,ham,shrimp,salmon,fish,tilapia,hot dog,brat,roast,ribs,meatball,ground',
  'Deli': 'deli,lunch meat,salami,pepperoni,sliced turkey,sliced ham,sliced cheese,rotisserie,hummus',
  'Bakery': 'bread,buns,rolls,bagel,muffin,tortilla,pita,croissant,donut,cake',
  'Dairy & Eggs': 'milk,egg,cheese,butter,yogurt,sour cream,cream cheese,half and half,creamer,cottage',
  'Frozen': 'frozen,ice cream,popsicle,nugget,tater tot,waffle,pizza',
  'Pantry/Dry Goods': 'rice,pasta,noodle,spaghetti,sauce,beans,canned,soup,flour,sugar,oil,vinegar,spice,seasoning,salt,cereal,oatmeal,peanut butter,jelly,syrup,ketchup,mustard,mayo,broth,stock,salsa,honey,mix,taco shells',
  'Snacks': 'chips,cracker,cookie,pretzel,popcorn,granola,fruit snack,goldfish,candy,snack',
  'Beverages': 'juice,orange juice,apple juice,soda,pop,water,coffee,tea,drink,lemonade,sparkling,gatorade',
  'Household': 'paper towel,toilet paper,tissue,napkin,soap,detergent,trash bag,foil,plastic wrap,ziploc,sponge,cleaner,bleach,shampoo,toothpaste,diaper,wipes,batteries',
};
function guessSection(name) {
  const known = knownItems().get(nameKey(name))?.section;
  if (known) return known;
  const n = String(name).toLowerCase();
  let best = 'Other', bestLen = 0;
  for (const [sec, words] of Object.entries(SECTION_WORDS)) {
    if (!state.sections.includes(sec)) continue;
    for (const w of words.split(',')) if (w.length > bestLen && n.includes(w)) { best = sec; bestLen = w.length; }
  }
  return best;
}

// Builds the grocery list for the current plan week.
function buildList() {
  const items = new Map();
  const add = (name, qty, unit, section, source, extra = {}) => {
    name = String(name ?? '').trim();
    if (!name) return;
    const key = nameKey(name);
    let it = items.get(key);
    if (!it) {
      it = { key, name, section: validSection(section), amounts: new Map(), extras: [], sources: [], manualIds: [], fromStaple: false };
      items.set(key, it);
    } else if (it.section === 'Other' && section) {
      it.section = validSection(section);
    }
    let n = parseQty(qty);
    const u = normUnit(unit);
    if (n === null && u) n = 1;
    if (typeof n === 'number' && !Number.isNaN(n)) it.amounts.set(u, (it.amounts.get(u) || 0) + n);
    else if (Number.isNaN(n)) it.extras.push(`${qty} ${unit || ''}`.trim());
    if (source && !it.sources.includes(source)) it.sources.push(source);
    if (extra.manualId) it.manualIds.push(extra.manualId);
    if (extra.staple) it.fromStaple = true;
  };

  const w = getWeek(state.week);
  for (const kind of ['dinner', 'lunch']) {
    if (kind === 'lunch' && !state.showLunch) continue;
    for (const v of w[kind]) {
      const meal = v && !v.startsWith('text:') ? mealById(v) : null;
      if (meal) for (const i of meal.ingredients) add(i.name, i.qty, i.unit, i.section, meal.name);
    }
  }
  for (const s of state.staples) if (s.status === 'need') add(s.name, s.qty, s.unit, s.section, 'Staple', { staple: true });
  for (const m of state.manual) add(m.name, m.qty, m.unit, m.section, 'Added', { manualId: m.id });

  for (const it of items.values()) {
    const parts = [];
    for (const [u, n] of it.amounts) {
      if (n > 0) parts.push(u ? `${fmtQty(n)} ${unitLabel(u, n)}` : fmtQty(n));
      else if (u) parts.push(u);
    }
    it.qtyText = [...parts, ...it.extras].join(' + ');
  }
  return [...items.values()];
}

function listStats(list = buildList()) {
  const active = list.filter((i) => !state.have[i.key]);
  const done = active.filter((i) => state.checked[i.key]).length;
  return { total: active.length, done, left: active.length - done };
}

/* ---------- UI state ---------- */
const ui = {
  tab: 'plan',
  sheet: null,       // { type, ... }
  mealSearch: '',
  showHave: false,
};
try { ui.tab = sessionStorage.getItem('durdy-tab') || 'plan'; } catch (e) { /* ignore */ }

/* ---------- rendering ---------- */
const TITLES = { plan: 'Meal Plan', meals: 'Meals', staples: 'Staples', list: 'Grocery List' };

function render() {
  applyTheme();
  $('#title').textContent = TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = $('#view');
  view.innerHTML = { plan: renderPlan, meals: renderMeals, staples: renderStaples, list: renderList }[ui.tab]();
  const stats = listStats();
  const badge = $('#list-badge');
  badge.hidden = !stats.left;
  badge.textContent = stats.left;
  $('#known-items').innerHTML = [...knownItems().values()].map((k) => `<option value="${esc(k.name)}">`).join('');
}

function renderPlan() {
  const ws = state.week;
  const w = getWeek(ws);
  const today = ymd(new Date());
  const thisWeek = weekStartOf();
  const rel = ws === thisWeek ? 'This week' : ws === addDays(thisWeek, 7) ? 'Next week' : ws === addDays(thisWeek, -7) ? 'Last week' : '';
  let html = `
    <div class="weeknav">
      <button class="nav-btn" data-a="week-prev" aria-label="Previous week">‹</button>
      <div class="mid">
        <div class="wk-title">${fmtWeek(ws)}</div>
        <div class="wk-sub">${rel || ''}${ws !== thisWeek ? ` <button data-a="week-today">Go to this week</button>` : ''}</div>
      </div>
      <button class="nav-btn" data-a="week-next" aria-label="Next week">›</button>
    </div>
    <div class="toggle-row"><span>Show lunch</span><button class="switch ${state.showLunch ? 'on' : ''}" data-a="toggle-lunch" aria-label="Show lunch"></button></div>`;
  for (let d = 0; d < 7; d++) {
    const date = addDays(ws, d);
    html += `<div class="card day ${date === today ? 'today' : ''}">
      <div class="day-label"><span>${DAY_NAMES[d]}</span><b>${parseYmd(date).getDate()}</b></div>
      <div class="slots">
        ${state.showLunch ? slotBtn(w.lunch[d], d, 'lunch') : ''}
        ${slotBtn(w.dinner[d], d, 'dinner')}
      </div>
    </div>`;
  }
  const planned = w.dinner.filter(Boolean).length + (state.showLunch ? w.lunch.filter(Boolean).length : 0);
  html += `
    <div class="btn-row">
      <button class="btn" data-a="copy-last">Copy last week</button>
      <button class="btn" data-a="clear-week">Clear week</button>
    </div>
    <div class="card plan-summary">
      <span class="muted">${planned} meal${planned === 1 ? '' : 's'} planned</span>
      <button class="btn primary" data-a="tab" data-tab="list">View list →</button>
    </div>`;
  return html;
}

function slotBtn(v, day, kind) {
  const label = slotLabel(v);
  const cls = !label ? '' : v.startsWith('text:') ? 'filled note' : 'filled';
  const kindName = kind === 'dinner' ? 'Dinner' : 'Lunch';
  return `<button class="slot ${cls}" data-a="pick" data-day="${day}" data-kind="${kind}">
    <span class="slot-kind">${kindName}</span>
    <span class="slot-meal">${label ? esc(label) : `+ Add ${kindName.toLowerCase()}`}</span>
  </button>`;
}

function renderMeals() {
  return `
    <input class="search" type="search" placeholder="Search meals or ingredients" value="${esc(ui.mealSearch)}" data-in="meal-search" autocomplete="off">
    <button class="btn primary block" style="margin:12px 0 14px" data-a="new-meal">+ New meal</button>
    <div id="meal-results">${mealResults()}</div>`;
}

function mealResults() {
  const q = ui.mealSearch.trim().toLowerCase();
  const w = getWeek(state.week);
  const meals = [...state.meals]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.ingredients.some((i) => i.name.toLowerCase().includes(q)));
  let html = '';
  if (!meals.length) html += `<p class="hint">${state.meals.length ? 'No meals match.' : 'No meals yet. Tap “New meal” to add one.'}</p>`;
  for (const m of meals) {
    const days = [];
    for (let d = 0; d < 7; d++) if (w.dinner[d] === m.id || (state.showLunch && w.lunch[d] === m.id)) days.push(DAY_NAMES[d]);
    html += `<button class="card meal-card" data-a="edit-meal" data-id="${m.id}">
      <h3>${esc(m.name)}${days.length ? `<span class="pill">${days.join(', ')}</span>` : ''}</h3>
      <p>${m.ingredients.length} ingredient${m.ingredients.length === 1 ? '' : 's'}${m.notes ? ' · ' + esc(m.notes) : ''}</p>
    </button>`;
  }
  return html;
}

function renderStaples() {
  const need = state.staples.filter((s) => s.status === 'need').length;
  const low = state.staples.filter((s) => s.status === 'low').length;
  let html = `<div class="staples-top">
      <span class="muted small">${need} need · ${low} low<br>Tap a name to edit it.</span>
      ${need || low ? '<button class="btn" data-a="clear-staples">Clear marks</button>' : ''}
    </div>`;
  for (const sec of sectionOrder()) {
    const rows = state.staples.filter((s) => validSection(s.section) === sec).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) continue;
    html += `<div class="section-title"><span>${esc(sec)}</span></div><div class="card staple-group">`;
    for (const s of rows) {
      const n = parseQty(s.qty);
      const amt = typeof n === 'number' && !Number.isNaN(n)
        ? [fmtQty(n), unitLabel(normUnit(s.unit), n)].filter(Boolean).join(' ')
        : [s.qty, s.unit].filter(Boolean).join(' ');
      html += `<div class="staple">
        <button class="staple-name" data-a="edit-staple" data-id="${s.id}"><b>${esc(s.name)}</b>${amt ? `<small>${esc(amt)}</small>` : ''}</button>
        <button class="tog low ${s.status === 'low' ? 'on' : ''}" data-a="staple-status" data-id="${s.id}" data-status="low">Low</button>
        <button class="tog need ${s.status === 'need' ? 'on' : ''}" data-a="staple-status" data-id="${s.id}" data-status="need">Need</button>
      </div>`;
    }
    html += `</div>`;
  }
  html += `<button class="btn block" style="margin-top:18px" data-a="new-staple">+ Add staple</button>
    <p class="hint">“Need” puts it on the grocery list. “Low” is a reminder only.</p>`;
  return html;
}

function renderList() {
  const list = buildList();
  const stats = listStats(list);
  const lows = state.staples.filter((s) => s.status === 'low');
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  let html = `<div class="card list-head">
    <div class="row"><b>Week of ${fmtWeek(state.week)}</b><span class="muted small">${stats.done} of ${stats.total} added</span></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <button class="btn primary block" data-a="copy-list" ${stats.total ? '' : 'disabled'}>Copy list as text</button>
    <form class="add-row" data-form="add-item">
      <input class="field" name="name" placeholder="Add an item…" autocomplete="off" list="known-items" enterkeyhint="done">
      <input class="field" name="qty" placeholder="Qty" style="width:64px;flex:none" inputmode="decimal" autocomplete="off">
      <button class="btn primary" type="submit" aria-label="Add">Add</button>
    </form>
  </div>`;

  if (lows.length) {
    html += `<div class="low-strip"><b>Running low</b> <span class="muted">(not on list, tap to add)</span>
      <div class="chips">${lows.map((s) => `<button class="chip" data-a="staple-status" data-id="${s.id}" data-status="need">+ ${esc(s.name)}</button>`).join('')}</div>
    </div>`;
  }

  const active = list.filter((i) => !state.have[i.key]);
  const haveItems = list.filter((i) => state.have[i.key]);

  if (!list.length) {
    html += `<div class="card empty" style="margin-top:14px"><h3>Your list is empty</h3>
      <p class="muted">Plan some meals, mark staples as “Need”, or add an item above.</p>
      <button class="btn primary" data-a="tab" data-tab="plan">Plan meals</button></div>`;
  }

  for (const sec of sectionOrder()) {
    const rows = active.filter((i) => i.section === sec).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) continue;
    const left = rows.filter((r) => !state.checked[r.key]).length;
    html += `<div class="section-title"><span>${esc(sec)}</span><span>${left ? left + ' left' : '✓'}</span></div>
      <div class="card group">${rows.map((i) => itemRow(i)).join('')}</div>`;
  }

  if (haveItems.length) {
    html += `<div class="section-title"><span>Already have (${haveItems.length})</span>
      <button class="link-btn" style="min-height:0;padding:0;font-size:13px" data-a="toggle-have-group">${ui.showHave ? 'Hide' : 'Show'}</button></div>`;
    if (ui.showHave) html += `<div class="card group have-group">${haveItems.sort((a, b) => a.name.localeCompare(b.name)).map((i) => itemRow(i, true)).join('')}</div>`;
  }

  html += `<div class="list-actions">
    <button class="btn block" data-a="new-week">Start new week</button>
  </div>
  <p class="hint">Check items off as you add them in the Meijer app.</p>`;
  return html;
}

function itemRow(i, inHave = false) {
  const done = !inHave && state.checked[i.key];
  const src = i.sources.join(' · ');
  return `<div class="item ${done ? 'done' : ''}">
    <button class="item-main" data-a="${inHave ? 'have' : 'check'}" data-key="${esc(i.key)}">
      ${inHave ? '' : '<span class="check"></span>'}
      <span class="item-text"><span class="item-name">${esc(i.name)}</span>${src ? `<span class="item-src">${esc(src)}</span>` : ''}</span>
      ${i.qtyText ? `<span class="item-qty">${esc(i.qtyText)}</span>` : ''}
    </button>
    ${inHave
      ? `<button class="have-btn" data-a="have" data-key="${esc(i.key)}">Need it</button>`
      : `<button class="have-btn" data-a="have" data-key="${esc(i.key)}">Have it</button>`}
    ${i.manualIds.length && !inHave ? `<button class="x-btn" data-a="del-manual" data-key="${esc(i.key)}" aria-label="Remove">×</button>` : ''}
  </div>`;
}

/* ---------- sheets (pop-up panels) ---------- */
function openSheet(sheet) {
  ui.sheet = sheet;
  renderSheet();
  $('#sheet').hidden = false;
  $('#backdrop').hidden = false;
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  ui.sheet = null;
  $('#sheet').hidden = true;
  $('#backdrop').hidden = true;
  document.body.classList.remove('sheet-open');
  render();
}
function sheetHead(title, left = 'Cancel', right = '') {
  return `<div class="sheet-head">
    <div class="left"><button class="link-btn" data-a="close-sheet">${left}</button></div>
    <h2>${esc(title)}</h2>
    <div class="right">${right}</div>
  </div>`;
}
function sectionOptions(selected) {
  return sectionOrder().map((s) => `<option ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
}

function renderSheet() {
  const s = ui.sheet;
  if (!s) return;
  const el = $('#sheet');
  const scroll = $('.sheet-body', el)?.scrollTop || 0;
  if (s.type === 'pick') el.innerHTML = renderPicker(s);
  else if (s.type === 'meal') el.innerHTML = renderMealEditor(s);
  else if (s.type === 'staple') el.innerHTML = renderStapleEditor(s);
  else if (s.type === 'settings') el.innerHTML = renderSettings();
  const body = $('.sheet-body', el);
  if (body && s.keepScroll) body.scrollTop = scroll;
  s.keepScroll = false;
}

function renderPicker(s) {
  const current = getWeek(state.week)[s.kind][s.day];
  const dayName = parseYmd(addDays(state.week, s.day)).toLocaleDateString(undefined, { weekday: 'long' });
  return `${sheetHead(`${dayName} ${s.kind}`)}
  <div class="sheet-body">
    <input class="search" type="search" placeholder="Search meals" value="${esc(s.search || '')}" data-in="pick-search" autocomplete="off">
    <div class="quick">
      ${QUICK_NOTES.map((t) => `<button class="chip" data-a="pick-note" data-note="${esc(t)}">${esc(t)}</button>`).join('')}
      ${current ? '<button class="chip" style="color:var(--danger)" data-a="pick-clear">Remove</button>' : ''}
    </div>
    <div class="card pick-list" id="pick-results">${pickResults(s)}</div>
    <button class="btn block" style="margin-top:14px" data-a="pick-new">+ New meal</button>
  </div>`;
}

function pickResults(s) {
  const current = getWeek(state.week)[s.kind][s.day];
  const q = (s.search || '').trim().toLowerCase();
  const meals = [...state.meals].sort((a, b) => a.name.localeCompare(b.name)).filter((m) => !q || m.name.toLowerCase().includes(q));
  return meals.map((m) => `<button class="pick ${m.id === current ? 'current' : ''}" data-a="pick-meal" data-id="${m.id}">
      <span>${esc(m.name)}<small>${m.ingredients.length} ingredients</small></span>${m.id === current ? '✓' : ''}
    </button>`).join('') || '<p class="hint">No meals match.</p>';
}

function renderMealEditor(s) {
  const d = s.draft;
  return `${sheetHead(s.isNew ? 'New meal' : 'Edit meal', 'Cancel', '<button class="link-btn bold" data-a="save-meal">Save</button>')}
  <div class="sheet-body">
    <label class="label">Meal name</label>
    <input class="field" data-f="name" value="${esc(d.name)}" placeholder="e.g. Burrito Bowls" autocomplete="off">
    <label class="label">Ingredients</label>
    ${d.ingredients.map((i, idx) => `<div class="card ing">
      <div class="ing-row">
        <input class="field" data-ing="${idx}" data-k="name" value="${esc(i.name)}" placeholder="Ingredient" list="known-items" autocomplete="off">
        <button class="x-btn" data-a="del-ing" data-idx="${idx}" aria-label="Remove ingredient">×</button>
      </div>
      <div class="ing-row">
        <input class="field qty" data-ing="${idx}" data-k="qty" value="${esc(i.qty)}" placeholder="Qty" inputmode="decimal" autocomplete="off">
        <input class="field unit" data-ing="${idx}" data-k="unit" value="${esc(i.unit)}" placeholder="Unit" autocomplete="off">
        <select class="field sec" data-ing="${idx}" data-k="section">${sectionOptions(i.section)}</select>
      </div>
    </div>`).join('')}
    <button class="btn block" data-a="add-ing">+ Add ingredient</button>
    <label class="label">Notes (optional)</label>
    <textarea class="field" data-f="notes" placeholder="Recipe link, tips, sides…">${esc(d.notes)}</textarea>
    ${s.isNew ? '' : `<div class="btn-row">
      <button class="btn" data-a="dup-meal">Duplicate</button>
      <button class="btn danger" data-a="del-meal">Delete</button>
    </div>`}
  </div>`;
}

function renderStapleEditor(s) {
  const d = s.draft;
  return `${sheetHead(s.isNew ? 'New staple' : 'Edit staple', 'Cancel', '<button class="link-btn bold" data-a="save-staple">Save</button>')}
  <div class="sheet-body">
    <label class="label">Name</label>
    <input class="field" data-f="name" value="${esc(d.name)}" placeholder="e.g. Milk" autocomplete="off" list="known-items">
    <label class="label">Usual amount (optional)</label>
    <div class="ing-row">
      <input class="field qty" data-f="qty" value="${esc(d.qty)}" placeholder="Qty" inputmode="decimal" autocomplete="off">
      <input class="field" data-f="unit" value="${esc(d.unit)}" placeholder="Unit (gal, bag…)" autocomplete="off">
    </div>
    <label class="label">Store section</label>
    <select class="field" data-f="section">${sectionOptions(d.section)}</select>
    ${s.isNew ? '' : '<button class="btn danger block" style="margin-top:24px" data-a="del-staple">Delete staple</button>'}
  </div>`;
}

function renderSettings() {
  return `${sheetHead('Settings', 'Done')}
  <div class="sheet-body">
    <label class="label">Appearance</label>
    <div class="seg">
      ${['auto', 'light', 'dark'].map((t) => `<button class="${state.theme === t ? 'on' : ''}" data-a="theme" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>

    <label class="label">Store sections (walking order)</label>
    <div class="card">
      ${state.sections.map((sec, i) => `<div class="sec-row">
        <span>${esc(sec)}</span>
        <button data-a="sec-up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
        <button data-a="sec-down" data-i="${i}" aria-label="Move down" ${i === state.sections.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
        <button data-a="sec-rename" data-i="${i}" aria-label="Rename">✎</button>
        <button data-a="sec-del" data-i="${i}" aria-label="Delete">×</button>
      </div>`).join('')}
    </div>
    <button class="btn block" style="margin-top:10px" data-a="sec-add">+ Add section</button>

    <label class="label">Backup</label>
    <div class="stack">
      <button class="btn block primary" data-a="export">Export backup file</button>
      <button class="btn block" data-a="import">Import backup file</button>
      <input type="file" id="import-file" accept=".json,application/json,text/plain" hidden>
    </div>
    <p class="hint">Data is saved only on this phone. Export a backup now and then (save it to Files or iCloud Drive).</p>

    <label class="label">Start over</label>
    <button class="btn block danger" data-a="reset-all">Reset to sample data</button>
    <p class="hint">Durdy Grocery · v1</p>
  </div>`;
}

/* ---------- actions ---------- */
function weekKindArr(kind) { return ensureWeek(state.week)[kind]; }

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    try { sessionStorage.setItem('durdy-tab', ui.tab); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  },
  'open-settings'() { openSheet({ type: 'settings' }); },
  'close-sheet'() { closeSheet(); },

  // Plan
  'week-prev'() { state.week = addDays(state.week, -7); commit(); },
  'week-next'() { state.week = addDays(state.week, 7); commit(); },
  'week-today'() { state.week = weekStartOf(); commit(); },
  'toggle-lunch'() { state.showLunch = !state.showLunch; commit(); },
  'copy-last'() {
    const prev = state.weeks[addDays(state.week, -7)];
    if (!prev || ![...prev.dinner, ...prev.lunch].some(Boolean)) return toast('Last week has nothing planned.');
    const cur = getWeek(state.week);
    if ([...cur.dinner, ...cur.lunch].some(Boolean) && !confirm('Replace this week’s plan with last week’s?')) return;
    state.weeks[state.week] = clone(prev);
    commit();
    toast('Copied last week');
  },
  'clear-week'() {
    const cur = getWeek(state.week);
    if (![...cur.dinner, ...cur.lunch].some(Boolean)) return;
    if (!confirm('Clear all meals for this week?')) return;
    state.weeks[state.week] = blankWeek();
    commit();
  },
  pick(el) { openSheet({ type: 'pick', day: +el.dataset.day, kind: el.dataset.kind, search: '' }); },
  'pick-meal'(el) { weekKindArr(ui.sheet.kind)[ui.sheet.day] = el.dataset.id; save(); closeSheet(); },
  'pick-note'(el) { weekKindArr(ui.sheet.kind)[ui.sheet.day] = 'text:' + el.dataset.note; save(); closeSheet(); },
  'pick-clear'() { weekKindArr(ui.sheet.kind)[ui.sheet.day] = ''; save(); closeSheet(); },
  'pick-new'() {
    const assign = { day: ui.sheet.day, kind: ui.sheet.kind };
    openSheet({ type: 'meal', isNew: true, assign, draft: newMealDraft(ui.sheet.search || '') });
    focusFirst('[data-f="name"]');
  },

  // Meals
  'new-meal'() { openSheet({ type: 'meal', isNew: true, draft: newMealDraft(ui.mealSearch) }); focusFirst('[data-f="name"]'); },
  'edit-meal'(el) {
    const m = mealById(el.dataset.id);
    if (!m) return;
    const draft = clone(m);
    if (!draft.ingredients.length) draft.ingredients.push(blankIng());
    openSheet({ type: 'meal', isNew: false, draft });
  },
  'add-ing'() {
    ui.sheet.draft.ingredients.push(blankIng());
    ui.sheet.keepScroll = true;
    renderSheet();
    const inputs = document.querySelectorAll('#sheet [data-k="name"]');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.scrollIntoView({ block: 'center' }); }
  },
  'del-ing'(el) {
    ui.sheet.draft.ingredients.splice(+el.dataset.idx, 1);
    ui.sheet.keepScroll = true;
    renderSheet();
  },
  'save-meal'() {
    const s = ui.sheet;
    const d = s.draft;
    d.name = d.name.trim();
    if (!d.name) { toast('Give the meal a name'); return focusFirst('[data-f="name"]'); }
    d.ingredients = d.ingredients
      .map((i) => ({ name: i.name.trim(), qty: String(i.qty).trim(), unit: i.unit.trim(), section: i.section }))
      .filter((i) => i.name);
    const idx = state.meals.findIndex((m) => m.id === d.id);
    if (idx >= 0) state.meals[idx] = d; else state.meals.push(d);
    if (s.assign) weekKindArr(s.assign.kind)[s.assign.day] = d.id;
    save();
    closeSheet();
    toast(s.isNew ? 'Meal added' : 'Meal saved');
  },
  'dup-meal'() {
    const d = clone(ui.sheet.draft);
    d.id = uid();
    d.name = `${d.name} (copy)`;
    openSheet({ type: 'meal', isNew: true, draft: d });
    focusFirst('[data-f="name"]');
  },
  'del-meal'() {
    const d = ui.sheet.draft;
    if (!confirm(`Delete “${d.name}”? It will be removed from any plans.`)) return;
    state.meals = state.meals.filter((m) => m.id !== d.id);
    for (const w of Object.values(state.weeks)) for (const kind of ['dinner', 'lunch']) w[kind] = w[kind].map((v) => (v === d.id ? '' : v));
    save();
    closeSheet();
    toast('Meal deleted');
  },

  // Staples
  'staple-status'(el) {
    const s = state.staples.find((x) => x.id === el.dataset.id);
    if (!s) return;
    const st = el.dataset.status;
    s.status = s.status === st ? '' : st;
    commit();
  },
  'clear-staples'() {
    if (!confirm('Clear all Low and Need marks?')) return;
    state.staples.forEach((s) => { s.status = ''; });
    commit();
  },
  'new-staple'() {
    openSheet({ type: 'staple', isNew: true, draft: { id: uid(), name: '', qty: '', unit: '', section: 'Produce', status: '' } });
    focusFirst('[data-f="name"]');
  },
  'edit-staple'(el) {
    const s = state.staples.find((x) => x.id === el.dataset.id);
    if (s) openSheet({ type: 'staple', isNew: false, draft: clone(s) });
  },
  'save-staple'() {
    const d = ui.sheet.draft;
    d.name = d.name.trim();
    if (!d.name) { toast('Give the staple a name'); return focusFirst('[data-f="name"]'); }
    const idx = state.staples.findIndex((s) => s.id === d.id);
    if (idx >= 0) state.staples[idx] = d; else state.staples.push(d);
    save();
    closeSheet();
  },
  'del-staple'() {
    const d = ui.sheet.draft;
    if (!confirm(`Delete “${d.name}” from staples?`)) return;
    state.staples = state.staples.filter((s) => s.id !== d.id);
    save();
    closeSheet();
  },

  // List
  check(el) {
    const k = el.dataset.key;
    if (state.checked[k]) delete state.checked[k]; else state.checked[k] = true;
    commit();
  },
  have(el) {
    const k = el.dataset.key;
    if (state.have[k]) { delete state.have[k]; }
    else { state.have[k] = true; toast('Moved to “Already have”'); }
    commit();
  },
  'toggle-have-group'() { ui.showHave = !ui.showHave; render(); },
  'del-manual'(el) {
    const item = buildList().find((i) => i.key === el.dataset.key);
    if (!item) return;
    state.manual = state.manual.filter((m) => !item.manualIds.includes(m.id));
    commit();
  },
  async 'copy-list'() {
    const text = listAsText();
    const ok = await copyText(text);
    toast(ok ? 'List copied. Paste it anywhere.' : 'Could not copy');
  },
  'new-week'() {
    const thisWeek = weekStartOf();
    const next = state.week <= thisWeek ? addDays(state.week, 7) : state.week;
    if (!confirm(`Start a new week?\n\nThis clears check marks, “Already have” marks, one-off items, and staples marked Need. Your meals and staples list stay. The plan moves to ${fmtWeek(next)}.`)) return;
    state.checked = {};
    state.have = {};
    state.manual = [];
    state.staples.forEach((s) => { if (s.status === 'need') s.status = ''; });
    state.week = next;
    ui.tab = 'plan';
    commit();
    window.scrollTo(0, 0);
    toast('New week started');
  },

  // Settings
  theme(el) { state.theme = el.dataset.theme; save(); applyTheme(); renderSheet(); },
  'sec-up'(el) { moveSection(+el.dataset.i, -1); },
  'sec-down'(el) { moveSection(+el.dataset.i, 1); },
  'sec-rename'(el) {
    const i = +el.dataset.i;
    const old = state.sections[i];
    const name = (prompt('Rename section', old) || '').trim();
    if (!name || name === old) return;
    if (state.sections.includes(name)) return toast('That section already exists');
    state.sections[i] = name;
    const fix = (x) => { if (x.section === old) x.section = name; };
    state.meals.forEach((m) => m.ingredients.forEach(fix));
    state.staples.forEach(fix);
    state.manual.forEach(fix);
    save();
    ui.sheet.keepScroll = true;
    renderSheet();
  },
  'sec-del'(el) {
    const i = +el.dataset.i;
    const sec = state.sections[i];
    if (state.sections.length <= 1) return;
    if (!confirm(`Delete the “${sec}” section? Items in it will show under “Other”.`)) return;
    state.sections.splice(i, 1);
    save();
    ui.sheet.keepScroll = true;
    renderSheet();
  },
  'sec-add'() {
    const name = (prompt('New section name') || '').trim();
    if (!name) return;
    if (state.sections.includes(name)) return toast('That section already exists');
    const otherIdx = state.sections.indexOf('Other');
    if (otherIdx >= 0) state.sections.splice(otherIdx, 0, name); else state.sections.push(name);
    save();
    ui.sheet.keepScroll = true;
    renderSheet();
  },
  export() { exportBackup(); },
  import() { $('#import-file').click(); },
  'reset-all'() {
    if (!confirm('Erase everything and start over with the sample meals and staples? Export a backup first if you want to keep your data.')) return;
    state = seedState();
    save();
    closeSheet();
    toast('Reset to sample data');
  },
};

function moveSection(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.sections.length) return;
  [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
  save();
  ui.sheet.keepScroll = true;
  renderSheet();
}

function blankIng() { return { name: '', qty: '', unit: '', section: 'Produce' }; }
function newMealDraft(name = '') { return { id: uid(), name, notes: '', ingredients: [blankIng(), blankIng(), blankIng()] }; }
function focusFirst(sel) { setTimeout(() => $('#sheet ' + sel)?.focus(), 60); }

/* ---------- list text, clipboard, backup ---------- */
function listAsText() {
  const list = buildList().filter((i) => !state.have[i.key]);
  const lines = [`Groceries – week of ${fmtWeek(state.week)}`];
  for (const sec of sectionOrder()) {
    const rows = list.filter((i) => i.section === sec).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) continue;
    lines.push('', sec.toUpperCase());
    for (const r of rows) lines.push(`• ${r.name}${r.qtyText ? ` (${r.qtyText})` : ''}`);
  }
  return lines.join('\n');
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

async function exportBackup() {
  const data = JSON.stringify({ app: 'durdy-grocery', exported: new Date().toISOString(), state }, null, 2);
  const filename = `durdy-grocery-backup-${ymd(new Date())}.json`;
  try {
    const file = new File([data], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Durdy Grocery backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded');
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed && parsed.state ? parsed.state : parsed;
    if (!incoming || !Array.isArray(incoming.meals) || !Array.isArray(incoming.staples)) throw new Error('bad file');
    if (!confirm(`Replace everything on this phone with this backup?\n\n${incoming.meals.length} meals, ${incoming.staples.length} staples.`)) return;
    state = normalizeState(incoming);
    save();
    closeSheet();
    toast('Backup restored');
  } catch (e) {
    toast('That file isn’t a Durdy Grocery backup');
  }
}

/* ---------- theme & toast ---------- */
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'light' || state.theme === 'dark') root.dataset.theme = state.theme;
  else delete root.dataset.theme;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- event wiring ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});

$('#backdrop').addEventListener('click', () => closeSheet());

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.in === 'meal-search') {
    ui.mealSearch = el.value;
    $('#meal-results').innerHTML = mealResults();
    return;
  }
  if (el.dataset.in === 'pick-search') {
    ui.sheet.search = el.value;
    $('#pick-results').innerHTML = pickResults(ui.sheet);
    return;
  }
  if (!ui.sheet || !ui.sheet.draft) return;
  if (el.dataset.f) ui.sheet.draft[el.dataset.f] = el.value;
  if (el.dataset.ing !== undefined) ui.sheet.draft.ingredients[+el.dataset.ing][el.dataset.k] = el.value;
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file') {
    if (el.files && el.files[0]) importBackup(el.files[0]);
    el.value = '';
    return;
  }
  if (!ui.sheet || !ui.sheet.draft) return;
  if (el.dataset.f) ui.sheet.draft[el.dataset.f] = el.value;
  if (el.dataset.ing !== undefined) ui.sheet.draft.ingredients[+el.dataset.ing][el.dataset.k] = el.value;
  // When an ingredient name matches something known, fill in its usual store section.
  const guessFrom = el.dataset.k === 'name' ? el : el.dataset.f === 'name' ? el : null;
  if (guessFrom && el.value.trim()) {
    const sec = guessSection(el.value);
    if (sec === 'Other') return;
    if (el.dataset.k === 'name') {
      const i = +el.dataset.ing;
      ui.sheet.draft.ingredients[i].section = sec;
      const sel = $(`#sheet select[data-ing="${i}"]`);
      if (sel) sel.value = validSection(sec);
    } else if (ui.sheet.type === 'staple') {
      ui.sheet.draft.section = sec;
      const sel = $('#sheet select[data-f="section"]');
      if (sel) sel.value = validSection(sec);
    }
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.form !== 'add-item') return;
  e.preventDefault();
  const name = form.elements.name.value.trim();
  if (!name) return;
  let qty = form.elements.qty.value.trim();
  let unit = '';
  const m = qty.match(/^([\d./\s½¼¾⅓⅔⅛]+)\s*([a-zA-Z]+)$/);
  if (m) { qty = m[1].trim(); unit = m[2]; }
  state.manual.push({ id: uid(), name, qty, unit, section: guessSection(name) });
  commit();
  toast(`Added ${name}`);
  const input = $('form[data-form="add-item"] input[name="name"]');
  if (input) input.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.sheet) closeSheet();
});

/* ---------- startup ---------- */
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
