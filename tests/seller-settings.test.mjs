// Store settings stored on the backend (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSettings, fromBackendSettings, hasSettings, settingsOf, toBackendSettings } from '../dist/seller-settings.js';

const seller = {
  serviceAreas: ['600040'],
  workingHours: [{ day: 'Mon', open: '09:00', close: '18:00', closed: false }],
  holidays: [{ id: 'h1', date: '2026-12-25', note: 'Christmas' }],
  fulfilment: { autoAccept: true, acceptWindowMins: 30, packingTimeMins: 60, minOrderValue: 199 },
  notifications: { new_order: { email: true, sms: false, push: true } },
  brandColor: '#2F7D32',
  bannerTagline: 'Fresh from the farm',
  staff: [{ id: 's1', name: 'Ravi', email: 'ravi@example.com', role: 'packer', invitedAt: '2026-11-01T00:00:00Z', active: true }],
};

test('settings round-trip through the backend shape unchanged', () => {
  const back = toBackendSettings(settingsOf(seller));
  assert.deepEqual(back.fulfilment, { auto_accept: true, accept_window_mins: 30, packing_time_mins: 60, min_order_value: 199 });
  assert.equal(back.staff[0].invited_at, '2026-11-01T00:00:00Z');
  assert.deepEqual(fromBackendSettings(back), seller);
});

test('only the settings sent are converted, and bad colours are left out', () => {
  assert.deepEqual(toBackendSettings({ bannerTagline: 'Hi' }), { banner_tagline: 'Hi' });
  assert.deepEqual(toBackendSettings({ brandColor: 'green' }), {});
  assert.deepEqual(toBackendSettings({ shopName: 'Not a setting' }), {});
  assert.equal(hasSettings({}), false);
  assert.equal(hasSettings({ banner_tagline: 'x' }), true);
});

test('only changed settings are applied to a device', () => {
  const patch = fromBackendSettings(toBackendSettings({ ...settingsOf(seller), bannerTagline: 'New tagline' }));
  assert.deepEqual(changedSettings(seller, patch), { bannerTagline: 'New tagline' });
});
