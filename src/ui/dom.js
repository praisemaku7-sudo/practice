const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape untrusted text (bank descriptions, file names...) before putting it in HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, { error = false } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 5000 : 2600);
}

let sheetCleanup = null;
export function openSheet(html, { onMount, wide = false } = {}) {
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet-panel ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-grabber"></div>${html}</div>`;
  root.classList.add('open');
  document.body.classList.add('no-scroll');
  sheetCleanup = onMount ? onMount(root.querySelector('.sheet-panel')) : null;
}
export function closeSheet() {
  const root = $('#sheet');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
}

export function busy(label) {
  openSheet(`<div class="busy"><div class="spinner"></div><p>${esc(label)}</p></div>`);
  return closeSheet;
}

export function confirmSheet({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row gap"><button class="btn ghost grow" id="c-no">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'} grow" id="c-yes">${esc(ok)}</button></div>`, {
      onMount(p) {
        p.querySelector('#c-no').onclick = () => { closeSheet(); resolve(false); };
        p.querySelector('#c-yes').onclick = () => { closeSheet(); resolve(true); };
      },
    });
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale big phone photos before sending (keeps API cost and upload time down). */
export async function imageForUpload(file, maxDim = 1568) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl };
}
