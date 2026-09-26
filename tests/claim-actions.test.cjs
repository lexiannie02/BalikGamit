const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const reportId = '11111111-1111-4111-8111-111111111111';
const claimId = '22222222-2222-4222-8222-222222222222';
const finderToken = 'a'.repeat(64);
const claimantToken = 'b'.repeat(64);
const sha = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

async function service() {
  const report = { id: reportId, title: 'Wallet', display_name: 'Finder', finder_secret_hash: await sha(finderToken) };
  const claim = { id: claimId, found_report_id: reportId, claimant_name: 'Owner', proof: 'Initials inside', status: 'Pending', claimant_secret_hash: await sha(claimantToken), created_at: '2026-09-27T00:00:00Z', meeting_place: 'Private draft' };
  const db = {
    from(table) {
      const query = { table, filters: [], changes: null,
        select() { return this; },
        eq(field, value) { this.filters.push([field, value]); return this; },
        update(changes) { this.changes = changes; return this; },
        order() { return Promise.resolve({ data: [claim] }); },
        async maybeSingle() {
          const row = this.table === 'reports' ? report : claim;
          if (this.filters.some(([field, value]) => row[field] !== value)) return { data: null };
          if (this.changes) Object.assign(row, this.changes);
          return { data: { ...row } };
        },
      };
      return query;
    },
  };
  let handler;
  const sandbox = {
    createClient: () => db,
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://test.example' : 'service-key' }, serve: fn => { handler = fn; } },
    crypto: webcrypto, TextEncoder, Response, Date, Set, Array, JSON,
  };
  const source = fs.readFileSync('supabase/functions/claim-actions/index.ts', 'utf8').replace(/^import[^\n]*\n/, '');
  vm.runInNewContext(stripTypeScriptTypes(source), sandbox);
  const send = async body => {
    const response = await handler({ method: 'POST', json: async () => body });
    return { status: response.status, body: await response.json() };
  };
  return { claim, send };
}

test('only finder can approve, and meeting details are required before approval', async () => {
  const { claim, send } = await service();
  const details = { action: 'approve', reportId, claimId, meetingPlace: 'Library desk', meetingAt: '2099-09-27T07:00:00.000Z', contactMethod: 'Facebook', contactValue: 'facebook.com/finder' };
  assert.equal((await send({ ...details, finderToken: claimantToken })).status, 403);
  assert.equal((await send({ action: 'approve', reportId, claimId, finderToken })).status, 400);
  assert.equal(claim.status, 'Pending');
  const approved = await send({ ...details, finderToken });
  assert.equal(approved.status, 200);
  assert.equal(claim.status, 'Approved');
  assert.equal(claim.meeting_place, 'Library desk');
  assert.equal(claim.finder_contact_value, 'facebook.com/finder');
});

test('claimant contact stays private until approval and finder can update older approvals', async () => {
  const { claim, send } = await service();
  claim.finder_contact_method = 'Facebook';
  claim.finder_contact_value = 'facebook.com/finder';
  const access = { action: 'list', claimantAccess: [{ claimId, token: claimantToken }] };
  const pending = await send(access);
  assert.equal(pending.body.claims[0].finder_contact_value, null);
  claim.status = 'Approved';
  const approved = await send(access);
  assert.equal(approved.body.claims[0].finder_contact_value, 'facebook.com/finder');
  const updated = await send({ action: 'set-handoff', reportId, claimId, finderToken, meetingPlace: 'School office', meetingAt: '2099-09-28T07:00:00.000Z', contactMethod: 'Email', contactValue: 'finder@example.com' });
  assert.equal(updated.status, 200);
  assert.equal(claim.finder_contact_value, 'finder@example.com');
});
