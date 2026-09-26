const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function appContext() {
  const app = { innerHTML: '' };
  const requests = [];
  const storage = new Map([['bg-name', JSON.stringify('Finder')]]);
  const formStatus = { textContent: '', hidden: true };
  const submitButton = { disabled: false };
  const sandbox = {
    document: {
      querySelector(selector) { return selector === '#app' ? app : null; },
      querySelectorAll() { return []; },
    },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    navigator: {},
    FormData: class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } },
    fetch(url, options) {
      if (url.endsWith('/reports-list')) return new Promise(() => {});
      const body = JSON.parse(options.body);
      requests.push(body);
      return Promise.resolve({ ok: true, json: async () => ({ claims: [] }) });
    },
    setTimeout() {},
    console,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  const makeForm = (claimId, fields) => ({
    dataset: { claim: claimId }, fields,
    querySelector(selector) { return selector === '#handoff-status' ? formStatus : selector === 'button[type="submit"]' ? submitButton : null; },
  });
  return { context, app, requests, makeForm, formStatus };
}

test('finder approval requires a meetup plan and shares it in one request', async () => {
  const { context, app, requests, makeForm } = appContext();
  vm.runInContext(`state.route='dashboard';state.claims=[{id:'claim-1',foundItemId:'report-1',title:'Wallet',claimant:'Owner',proof:'Initials inside',status:'Pending',role:'finder'}];state.finderAccess={'report-1':{token:'finder-token',ownerName:'Finder'}}`, context);
  await vm.runInContext(`reviewClaim('claim-1','approve')`, context);
  assert.equal(vm.runInContext('state.claims[0].status', context), 'Pending');
  assert.match(app.innerHTML, /Approve and share details/);
  assert.match(app.innerHTML, /Meeting place.*Required/);
  assert.match(app.innerHTML, /Philippine time/);
  assert.match(app.innerHTML, /Facebook/);
  context.form = makeForm('claim-1', {
    meetingPlace: 'Library desk', meetingAt: '2099-09-27T15:00',
    contactMethod: 'Facebook', contactValue: 'facebook.com/finder', note: 'After class',
  });
  await vm.runInContext(`submitHandoff({preventDefault(){},currentTarget:form})`, context);
  const approved = requests.find(request => request.action === 'approve');
  assert.ok(approved);
  assert.equal(approved.finderToken, 'finder-token');
  assert.equal(approved.meetingPlace, 'Library desk');
  assert.equal(approved.meetingAt, '2099-09-27T07:00:00.000Z');
  assert.equal(approved.contactMethod, 'Facebook');
  assert.equal(approved.contactValue, 'facebook.com/finder');
});

test('owner sees handoff details only after approval; finder can update an older approval', () => {
  const { context, app } = appContext();
  vm.runInContext(`state.route='dashboard';state.name='Owner';state.claims=[{id:'claim-1',foundItemId:'report-1',title:'Wallet',claimant:'Owner',finderName:'Finder',proof:'Initials inside',status:'Pending',role:'claimant',meetingPlace:'Library desk',meetingAt:'2099-09-27T07:00:00.000Z',contactMethod:'Facebook',contactValue:'facebook.com/finder'}];render()`, context);
  assert.doesNotMatch(app.innerHTML, /facebook\.com\/finder/);
  assert.doesNotMatch(app.innerHTML, /data-approve=/);
  vm.runInContext(`state.claims[0].status='Approved';render()`, context);
  assert.match(app.innerHTML, /Library desk/);
  assert.match(app.innerHTML, /facebook\.com\/finder/);
  assert.match(app.innerHTML, /PHT/);
  vm.runInContext(`state.name='Finder';state.claims[0].role='finder';state.claims[0].meetingPlace='';render()`, context);
  assert.match(app.innerHTML, /Add meetup details/);
});
