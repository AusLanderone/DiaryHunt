// The card grid both tabs are laid out on: cards stand in the order they were
// dragged into, at the size they were dragged to, on one raster of equal
// columns and rows of a known height. The statistics and the balances tabs each
// pass their own widgets and their own settings keys — one implementation, so
// the two can never drift apart in look or behaviour.
// IIFE-scoped like the other renderer files.
(function () {

const WO = () => window.widgetOrder;
const WS = () => window.widgetSize;
const ROW_UNIT = 120;
const GAP = 14;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// order and sizes are read once and kept here; the settings on disk are the
// backup copy, not the working one
const cache = {};
const settings = () => window.appSettings || {};

const orderOf = (o) => (cache[o.orderKey]
  || (cache[o.orderKey] = WO().normalize(settings()[o.orderKey], o.ids)));

const sizesOf = (o) => (cache[o.sizeKey]
  || (cache[o.sizeKey] = WS().normalize(settings()[o.sizeKey], o.sizeDefaults)));

async function save(key, value) {
  cache[key] = value;
  window.appSettings = { ...settings(), [key]: value };
  try {
    await window.api.config.setSettings({ [key]: value });
  } catch { /* the view is already right; the disk write is best effort */ }
}

// whether anything has been moved or resized — the toolbar only offers a way
// back when there is something to go back from
const changed = (o) => orderOf(o).join() !== o.ids.join()
  || JSON.stringify(sizesOf(o)) !== JSON.stringify(WS().defaults(o.sizeDefaults));

async function reset(o) {
  await save(o.orderKey, [...o.ids]);
  await save(o.sizeKey, WS().defaults(o.sizeDefaults));
}

// ---------- the raster ----------

function metricsOf(grid) {
  const cols = WS().columnsFor(grid.clientWidth || 1000);
  const cellW = (grid.clientWidth - GAP * (cols - 1)) / cols + GAP;
  return { cols, cellW, cellH: ROW_UNIT + GAP };
}

function applySpan(box, o, id, cols) {
  const span = WS().spanFor(sizesOf(o)[id], cols);
  box.style.gridColumn = `span ${span.cols}`;
  box.style.gridRow = `span ${span.rows}`;
}

// every card carries its buttons in one corner; a card built without the
// holder gets one here rather than each tab having to remember
function toolsOf(box) {
  let tools = box.querySelector('.card-tools');
  if (!tools) {
    tools = el('div', 'card-tools');
    box.appendChild(tools);
  }
  return tools;
}

// ---------- moving a card ----------

let draggingId = null;

const clearHints = (grid) => [...grid.children]
  .forEach((c) => c.classList.remove('drop-target', 'dragging'));

function draggable(box, o, id, grid) {
  const handle = el('button', 'card-drag', '⠿');
  handle.title = 'Перетащить виджет на другое место';
  // a card is only draggable while its handle is held, so a stray drag across
  // a chart cannot pick the whole widget up
  handle.onmousedown = () => { box.draggable = true; };
  handle.onmouseup = () => { box.draggable = false; };
  handle.onclick = (e) => e.stopPropagation();
  toolsOf(box).prepend(handle);

  box.addEventListener('dragstart', (e) => {
    draggingId = id;
    box.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch { /* older engines */ }
    }
  });
  box.addEventListener('dragend', () => {
    draggingId = null;
    box.draggable = false;
    clearHints(grid);
  });
  box.addEventListener('dragover', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    box.classList.add('drop-target');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop-target'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault();
    const from = draggingId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    draggingId = null;
    clearHints(grid);
    if (!from || from === id) return;
    await save(o.orderKey, WO().move(orderOf(o), from, id));
    o.redraw();
  });
}

// ---------- resizing a card ----------

function resizable(box, o, id, grid) {
  const grip = el('div', 'card-resize');
  grip.title = 'Потянуть за угол, чтобы изменить размер';
  box.appendChild(grip);

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const metrics = metricsOf(grid);
    const start = { ...sizesOf(o)[id] };
    const from = { x: e.clientX, y: e.clientY };
    let next = start;
    box.classList.add('resizing');
    // capture keeps the drag alive when the pointer leaves the grip; it can
    // refuse (a synthetic pointer, a released one) and the drag still works
    try { grip.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

    const onMove = (ev) => {
      next = WS().resize(start, ev.clientX - from.x, ev.clientY - from.y,
        { cellW: metrics.cellW, cellH: metrics.cellH, maxCols: metrics.cols });
      box.style.gridColumn = `span ${next.cols}`;
      box.style.gridRow = `span ${next.rows}`;
    };
    const onUp = async () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      box.classList.remove('resizing');
      if (next.cols !== start.cols || next.rows !== start.rows) {
        await save(o.sizeKey, { ...sizesOf(o), [id]: next });
      }
      o.redraw();   // charts redraw at whatever size they now have
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });
}

// ---------- the grid itself ----------

// o: { orderKey, sizeKey, ids, sizeDefaults, builders, redraw, width }
function render(o) {
  const grid = el('div', 'stats-grid');
  const cols = WS().columnsFor(o.width || 1000);
  grid.style.setProperty('--cols', String(cols));
  grid.style.setProperty('--unit', ROW_UNIT + 'px');

  orderOf(o).forEach((id) => {
    if (!o.builders[id]) return;
    const box = o.builders[id]();
    if (!box) return;
    box.dataset.widget = id;
    applySpan(box, o, id, cols);
    draggable(box, o, id, grid);
    resizable(box, o, id, grid);
    grid.appendChild(box);
  });
  return grid;
}

window.gridCards = { render, changed, reset, ROW_UNIT };
})();
