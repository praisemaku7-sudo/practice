// App lock: Face ID / Touch ID via the iPhone's passkey support (WebAuthn), with a backup PIN.
// It's a privacy screen for this device — your data never leaves the phone either way.
import { db } from '../lib/db.js';
import { esc, toast } from './dom.js';

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return b64u(d);
}

export async function lockSettings() { return (await db.kvGet('lock', null)) || { enabled: false, timeoutMin: 1 }; }

export async function biometricsAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

/** Turn the lock on: register a passkey (Face ID) on this device and store a backup PIN. */
export async function enableLock(pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('Choose a 4–6 digit backup PIN.');
  const salt = b64u(random(16));
  const lock = { enabled: true, timeoutMin: 1, salt, pinHash: await hashPin(pin, salt), credId: null };
  if (await biometricsAvailable()) {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'Pocket Ledger', id: location.hostname },
        user: { id: random(16), name: 'Pocket Ledger', displayName: 'Pocket Ledger' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        attestation: 'none',
        timeout: 60000,
      },
    });
    lock.credId = b64u(cred.rawId);
  }
  await db.kvSet('lock', lock);
  return lock;
}

export async function disableLock() { await db.kvSet('lock', { enabled: false, timeoutMin: 1 }); }

async function verifyBiometric(lock) {
  const assertion = await navigator.credentials.get({
    publicKey: { challenge: random(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64u(lock.credId) }], userVerification: 'required', timeout: 60000 },
  });
  // Flags byte (index 32): bit 2 = user verified (Face ID / passcode actually checked).
  const flags = new Uint8Array(assertion.response.authenticatorData)[32];
  return !!(flags & 0x04);
}

let locked = false;
let hiddenAt = 0;

function overlay(lock, onUnlock) {
  locked = true;
  document.body.classList.add('is-locked');
  let el = document.getElementById('lock');
  if (!el) { el = document.createElement('div'); el.id = 'lock'; document.body.appendChild(el); }
  let pin = '';
  const draw = (msg = '') => {
    el.innerHTML = `<div class="lock-box">
      <div class="logo big-logo">£</div><h2>Pocket Ledger is locked</h2>
      ${lock.credId ? '<button class="btn primary full" id="lk-face">Unlock with Face ID</button>' : ''}
      <p class="sub">${lock.credId ? 'or enter your backup PIN' : 'Enter your PIN'}</p>
      <div class="pin-dots">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
      <div class="lock-msg">${esc(msg)}</div>
      <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => `<button ${k === '' ? 'disabled' : ''} data-k="${k}">${k}</button>`).join('')}</div>
      <button class="link" id="lk-ok">Unlock</button></div>`;
    el.querySelector('#lk-face')?.addEventListener('click', tryFace);
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
      draw();
      if (pin.length === 6) tryPin();
    }));
    el.querySelector('#lk-ok').addEventListener('click', tryPin);
  };
  const done = () => { locked = false; document.body.classList.remove('is-locked'); el.remove(); onUnlock?.(); };
  const tryPin = async () => {
    if (pin.length < 4) return draw('Enter at least 4 digits');
    if ((await hashPin(pin, lock.salt)) === lock.pinHash) done(); else { pin = ''; draw('Wrong PIN'); }
  };
  const tryFace = async () => {
    try { if (await verifyBiometric(lock)) done(); else draw('Face ID not confirmed'); } catch (e) { draw(e?.name === 'NotAllowedError' ? 'Face ID cancelled. Use your PIN.' : "Face ID isn't available. Use your PIN."); }
  };
  draw();
}

/** Call once at start-up: locks immediately, and again after the app has been in the background. */
export async function initLock(onUnlock) {
  const lock = await lockSettings();
  if (!lock.enabled) return false;
  overlay(lock, onUnlock);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const l = await lockSettings();
    if (l.enabled && !locked && Date.now() - hiddenAt > (l.timeoutMin ?? 1) * 60000) overlay(l);
  });
  return true;
}

export async function lockSettingsCard() {
  const lock = await lockSettings();
  const bio = await biometricsAvailable();
  return `<div class="card"><h3>App lock</h3>
    ${lock.enabled
      ? `<p class="muted">On: ${lock.credId ? 'Face ID with backup PIN' : 'PIN'}. Locks when you open the app and after ${lock.timeoutMin} minute${lock.timeoutMin === 1 ? '' : 's'} in the background.</p>
         <button class="btn danger full" data-action="lock-off">Turn off app lock</button>`
      : `<p class="muted">${bio ? 'Unlock with Face ID, and a backup PIN in case Face ID fails.' : "This browser can't use Face ID, so the lock uses a PIN only. Add the app to your Home Screen for Face ID."}</p>
         <label class="field"><span>Backup PIN</span><input id="lock-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="4–6 digits"></label>
         <button class="btn primary full" data-action="lock-on">Turn on ${bio ? 'Face ID lock' : 'PIN lock'}</button>`}
  </div>`;
}

export const lockActions = {
  'lock-on': async (_, rerender) => {
    try {
      const l = await enableLock(document.getElementById('lock-pin').value.trim());
      toast(l.credId ? 'Face ID lock is on' : 'PIN lock is on');
    } catch (e) { toast(e?.name === 'NotAllowedError' ? 'Face ID setup was cancelled' : e.message, { error: true }); }
    rerender();
  },
  'lock-off': async (_, rerender) => { await disableLock(); toast('App lock is off'); rerender(); },
};
