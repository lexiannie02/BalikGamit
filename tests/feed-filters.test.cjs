const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('View all category buttons filter found items and work with search', () => {
  let html = '';
  let feedInput;
  let searchButton;
  let navButtons = [];
  let categoryButtons = [];
  const app = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      feedInput = html.includes('id="feed-search"') ? { value: '' } : null;
      searchButton = html.includes('id="feed-search-btn"') ? {} : null;
      navButtons = buttons('data-nav');
      categoryButtons = buttons('data-feed-category');
    },
  };
  const buttons = attribute => [...html.matchAll(new RegExp(`<button\\b[^>]*${attribute}="([^"]+)"[^>]*>`, 'g'))]
    .map(([, value]) => ({ dataset: { [attribute === 'data-nav' ? 'nav' : 'feedCategory']: value } }));
  const document = {
    querySelector: selector => ({ '#app': app, '#feed-search': feedInput, '#feed-search-btn': searchButton })[selector] || null,
    querySelectorAll: selector => selector === '[data-nav]' ? navButtons
      : selector === '[data-feed-category]' ? categoryButtons : [],
  };
  const storage = new Map([['bg-name', '"Tester"']]);
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  const source = fs.readFileSync('app.js', 'utf8');
  const context = { document, localStorage, navigator: {}, fetch: () => new Promise(() => {}), setTimeout };
  vm.runInNewContext(`${source}\n;globalThis.setFoundForTest = items => { state.found = items; render(); }`, context);
  context.setFoundForTest([
    { id: '1', title: 'Blue earbuds', category: 'Electronics', color: 'Blue', status: 'Active', date: '2026-09-27' },
    { id: '2', title: 'Brown wallet', category: 'Wallets', color: 'Brown', status: 'Active', date: '2026-09-27' },
    { id: '3', title: 'Black backpack', category: 'Bags', color: 'Black', status: 'Active', date: '2026-09-27' },
    { id: '4', title: 'Returned phone', category: 'Electronics', status: 'Returned', date: '2026-09-27' },
  ]);

  const cards = () => [...html.matchAll(/<article class="item-card">[\s\S]*?<h3>(.*?)<\/h3>/g)].map(([, title]) => title);
  const clickNav = route => {
    const button = document.querySelectorAll('[data-nav]').find(item => item.dataset.nav === route);
    assert.ok(button, `${route} navigation exists`);
    button.onclick();
  };
  const clickCategory = category => {
    const button = document.querySelectorAll('[data-feed-category]').find(item => item.dataset.feedCategory === category);
    assert.ok(button, `${category} button exists`);
    button.onclick();
    assert.match(html, new RegExp(`class="filter active" data-feed-category="${category}" aria-pressed="true"`));
  };

  assert.deepEqual(cards(), ['Blue earbuds', 'Brown wallet', 'Black backpack']);
  clickNav('foundfeed');
  assert.deepEqual(cards(), ['Blue earbuds', 'Brown wallet', 'Black backpack']);
  clickCategory('Wallets');
  assert.deepEqual(cards(), ['Brown wallet']);
  feedInput.value = 'blue';
  searchButton.onclick();
  assert.deepEqual(cards(), []);
  clickCategory('Electronics');
  assert.deepEqual(cards(), ['Blue earbuds']);
  clickCategory('All items');
  assert.deepEqual(cards(), ['Blue earbuds']);
  feedInput.value = '';
  searchButton.onclick();
  assert.deepEqual(cards(), ['Blue earbuds', 'Brown wallet', 'Black backpack']);
  clickCategory('Bags');
  clickNav('home');
  clickNav('foundfeed');
  assert.deepEqual(cards(), ['Blue earbuds', 'Brown wallet', 'Black backpack']);
  assert.match(html, /class="filter active" data-feed-category="All items" aria-pressed="true"/);
});
