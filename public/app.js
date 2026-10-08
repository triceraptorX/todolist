'use strict';

/* ================= Utilitaires ================= */

const $app = document.getElementById('app');

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Création d'éléments : h('div', { class: 'x', onclick: fn }, enfant1, enfant2...)
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  indent: '<path d="M4 6h16M10 12h10M10 18h10M4 10l3 2-3 2"/>',
  outdent: '<path d="M4 6h16M10 12h10M10 18h10M7 10l-3 2 3 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
};

function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2600);
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
    ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'progress' + (total && done === total ? ' full' : '') },
    h('div', { class: 'progress-fill', style: `width:${pct}%` }));
}

function topbar({ back, title, actions = [] }) {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'btn icon ghost', href: back, 'aria-label': 'Retour' }, icon('back')) : null,
    h('h1', { class: 'topbar-title' }, title),
    h('div', { class: 'topbar-actions' }, actions));
}

// Menu déroulant basé sur <details> (fonctionne au doigt comme à la souris)
function dropdown(entries, label = 'Plus d’options') {
  const menu = h('details', { class: 'dropdown' },
    h('summary', { class: 'btn icon ghost', 'aria-label': label }, icon('more')),
    h('div', { class: 'dropdown-menu' },
      entries.filter(Boolean).map((e) =>
        h('button', {
          class: 'dropdown-item' + (e.danger ? ' danger' : ''),
          type: 'button',
          onclick: () => {
            menu.open = false;
            e.action();
          },
        }, icon(e.icon), e.label))));
  return menu;
}

document.addEventListener('click', (e) => {
  document.querySelectorAll('details.dropdown[open]').forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});

/* ================= Logique des arbres ================= */

function countItems(items) {
  return items.reduce((n, it) => n + 1 + countItems(it.children), 0);
}

function leafStats(items, acc = { done: 0, total: 0 }) {
  for (const it of items) {
    if (it.children.length) leafStats(it.children, acc);
    else {
      acc.total++;
      if (it.checked) acc.done++;
    }
  }
  return acc;
}

function setAll(items, checked) {
  for (const it of items) {
    it.checked = checked;
    setAll(it.children, checked);
  }
}

function normalize(items) {
  for (const it of items) {
    if (it.children.length) {
      normalize(it.children);
      it.checked = it.children.every((c) => c.checked);
    }
  }
}

function anyChecked(items) {
  return items.some((it) => it.checked || anyChecked(it.children));
}

// Retourne { list, index, item, parent } pour l'id donné
function locate(items, id, parent = null) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { list: items, index: i, item: items[i], parent };
    const found = locate(items[i].children, id, items[i]);
    if (found) return found;
  }
  return null;
}

/* ================= Routeur ================= */

let cleanup = null;

async function router() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  window.scrollTo(0, 0);
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  try {
    if (!parts.length) await viewHome();
    else if (parts[0] === 'edit' && parts[1]) await viewEdit(parts[1]);
    else if (parts[0] === 'run' && parts[1]) await viewRun(parts[1]);
    else location.hash = '#/';
  } catch (err) {
    $app.replaceChildren(
      topbar({ back: '#/', title: 'Oups' }),
      h('main', { class: 'container' },
        h('div', { class: 'empty' }, h('p', {}, err.message), h('a', { class: 'btn primary', href: '#/' }, 'Retour à l’accueil'))));
  }
}

window.addEventListener('hashchange', router);

/* ================= Accueil ================= */

async function viewHome() {
  const [checklists, runs] = await Promise.all([api('GET', '/api/checklists'), api('GET', '/api/runs')]);
  const active = runs.filter((r) => !r.finishedAt);
  const finished = runs.filter((r) => r.finishedAt);

  async function createChecklist() {
    try {
      const c = await api('POST', '/api/checklists', { title: 'Nouvelle checklist' });
      location.hash = `#/edit/${c.id}?new`;
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function launch(c) {
    try {
      const r = await api('POST', `/api/checklists/${c.id}/runs`);
      location.hash = `#/run/${r.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function duplicate(c) {
    try {
      await api('POST', `/api/checklists/${c.id}/duplicate`);
      toast('Checklist dupliquée');
      router();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function remove(c) {
    if (!confirm(`Supprimer la checklist « ${c.title} » ?\nLes sessions déjà lancées sont conservées.`)) return;
    try {
      await api('DELETE', `/api/checklists/${c.id}`);
      toast('Checklist supprimée');
      router();
    } catch (err) {
      toast(err.message, true);
    }
  }

  const runCard = (r) =>
    h('a', { class: 'card run-card', href: `#/run/${r.id}` },
      h('div', { class: 'card-head' },
        h('span', { class: 'card-title' }, r.title),
        h('span', { class: 'badge' + (r.done === r.total ? ' ok' : '') }, `${r.done}/${r.total}`)),
      progressBar(r.done, r.total),
      h('div', { class: 'card-meta' }, r.finishedAt ? `Terminée le ${fmtDate(r.finishedAt)}` : `Lancée le ${fmtDate(r.startedAt)}`));

  const checklistCard = (c) =>
    h('div', { class: 'card' },
      h('a', { class: 'card-body', href: `#/edit/${c.id}` },
        h('span', { class: 'card-title' }, c.title || 'Sans titre'),
        c.description ? h('span', { class: 'card-desc' }, c.description) : null,
        h('span', { class: 'card-meta' }, c.count ? `${c.count} tâche${c.count > 1 ? 's' : ''}` : 'Vide')),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn primary', type: 'button', disabled: !c.count, onclick: () => launch(c) }, icon('play'), 'Lancer'),
        h('a', { class: 'btn', href: `#/edit/${c.id}` }, icon('edit'), 'Modifier'),
        dropdown([
          { icon: 'copy', label: 'Dupliquer', action: () => duplicate(c) },
          { icon: 'trash', label: 'Supprimer', danger: true, action: () => remove(c) },
        ])));

  $app.replaceChildren(
    topbar({
      title: 'Checklists',
      actions: [h('button', { class: 'btn primary', type: 'button', onclick: createChecklist }, icon('plus'), h('span', { class: 'hide-xs' }, 'Nouvelle'))],
    }),
    h('main', { class: 'container' },
      active.length
        ? h('section', {}, h('h2', { class: 'section-title' }, 'En cours'), h('div', { class: 'grid' }, active.map(runCard)))
        : null,
      h('section', {},
        h('h2', { class: 'section-title' }, 'Mes checklists'),
        checklists.length
          ? h('div', { class: 'grid' }, checklists.map(checklistCard))
          : h('div', { class: 'empty' },
              h('p', {}, 'Aucune checklist pour le moment.'),
              h('button', { class: 'btn primary', type: 'button', onclick: createChecklist }, icon('plus'), 'Créer ma première checklist'))),
      finished.length
        ? h('details', { class: 'history' },
            h('summary', { class: 'section-title' }, `Historique (${finished.length})`),
            h('div', { class: 'grid' }, finished.map(runCard)))
        : null));
}

/* ================= Éditeur ================= */

async function viewEdit(rawId) {
  const [id, query] = rawId.split('?');
  const isNew = query === 'new';
  const data = await api('GET', `/api/checklists/${id}`);
  let openActions = null; // id de la tâche dont la barre d'actions est ouverte

  /* --- Sauvegarde automatique --- */
  let saveTimer = null;
  let saving = false;
  let dirty = false;
  const status = h('span', { class: 'save-status' }, 'Enregistré');

  function setStatus(text, cls = '') {
    status.textContent = text;
    status.className = 'save-status ' + cls;
  }

  function scheduleSave() {
    dirty = true;
    setStatus('Modifié…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    if (saving) {
      saveTimer = setTimeout(save, 300);
      return;
    }
    saving = true;
    dirty = false;
    setStatus('Enregistrement…');
    try {
      await api('PUT', `/api/checklists/${id}`, { title: data.title, description: data.description, items: data.items });
      setStatus(dirty ? 'Modifié…' : 'Enregistré', dirty ? '' : 'ok');
    } catch (err) {
      dirty = true;
      setStatus('Erreur', 'error');
      toast(`Sauvegarde impossible : ${err.message}`, true);
    } finally {
      saving = false;
    }
  }

  function flushOnHide() {
    if (!dirty) return;
    fetch(`/api/checklists/${id}`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: data.title, description: data.description, items: data.items }),
    });
    dirty = false;
  }
  window.addEventListener('pagehide', flushOnHide);
  cleanup = () => {
    window.removeEventListener('pagehide', flushOnHide);
    save();
  };

  /* --- Opérations sur l'arbre --- */
  const newItem = () => ({ id: uid(), text: '', children: [] });

  const ops = {
    addAfter(itemId) {
      const loc = locate(data.items, itemId);
      const it = newItem();
      loc.list.splice(loc.index + 1, 0, it);
      return it.id;
    },
    addChild(itemId) {
      const loc = locate(data.items, itemId);
      const it = newItem();
      loc.item.children.push(it);
      return it.id;
    },
    up(itemId) {
      const { list, index } = locate(data.items, itemId);
      if (index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
      return itemId;
    },
    down(itemId) {
      const { list, index } = locate(data.items, itemId);
      if (index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
      return itemId;
    },
    indent(itemId) {
      const { list, index, item } = locate(data.items, itemId);
      if (index === 0) return itemId;
      list.splice(index, 1);
      list[index - 1].children.push(item);
      return itemId;
    },
    outdent(itemId) {
      const { list, index, item, parent } = locate(data.items, itemId);
      if (!parent) return itemId;
      const ploc = locate(data.items, parent.id);
      list.splice(index, 1);
      ploc.list.splice(ploc.index + 1, 0, item);
      return itemId;
    },
    remove(itemId) {
      const { list, index, item, parent } = locate(data.items, itemId);
      const n = countItems(item.children);
      if (n && !confirm(`Supprimer cette tâche et ses ${n} sous-tâche${n > 1 ? 's' : ''} ?`)) return null;
      list.splice(index, 1);
      // Focus sur la tâche précédente (ou le parent)
      if (index > 0) {
        let prev = list[index - 1];
        while (prev.children.length) prev = prev.children[prev.children.length - 1];
        return prev.id;
      }
      return parent ? parent.id : list[0]?.id ?? null;
    },
  };

  function apply(op, itemId, opts = {}) {
    const focusId = ops[op](itemId);
    if (focusId === null && op === 'remove' && locate(data.items, itemId)) return; // annulé
    scheduleSave();
    renderTree();
    if (focusId) focusItem(focusId, opts.caretEnd !== false);
  }

  function focusItem(itemId, caretEnd = true) {
    const input = tree.querySelector(`.ed-item[data-id="${itemId}"] > .ed-row > .ed-input`);
    if (!input) return;
    input.focus({ preventScroll: false });
    if (caretEnd) input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView({ block: 'nearest' });
  }

  /* --- Rendu --- */
  const tree = h('ul', { class: 'ed-tree' });

  function renderItems(items, depth) {
    return items.map((it, i) => {
      const actionsOpen = openActions === it.id;
      return h('li', { class: 'ed-item', 'data-id': it.id },
        h('div', { class: 'ed-row' },
          h('span', { class: 'ed-bullet' + (it.children.length ? ' parent' : '') }),
          h('input', {
            class: 'ed-input',
            type: 'text',
            value: it.text,
            placeholder: depth ? 'Sous-tâche…' : 'Tâche…',
            maxlength: '500',
            enterkeyhint: 'next',
            'data-id': it.id,
          }),
          h('button', { class: 'btn icon ghost sm', type: 'button', 'data-act': 'addChild', title: 'Ajouter une sous-tâche', 'aria-label': 'Ajouter une sous-tâche' }, icon('plus')),
          h('button', { class: 'btn icon ghost sm' + (actionsOpen ? ' active' : ''), type: 'button', 'data-act': 'toggleActions', title: 'Actions', 'aria-label': 'Actions', 'aria-expanded': String(actionsOpen) }, icon('more'))),
        actionsOpen
          ? h('div', { class: 'ed-actions' },
              h('button', { class: 'btn sm', type: 'button', 'data-act': 'up', disabled: i === 0, title: 'Monter' }, icon('up')),
              h('button', { class: 'btn sm', type: 'button', 'data-act': 'down', disabled: i === items.length - 1, title: 'Descendre' }, icon('down')),
              h('button', { class: 'btn sm', type: 'button', 'data-act': 'outdent', disabled: depth === 0, title: 'Désindenter' }, icon('outdent')),
              h('button', { class: 'btn sm', type: 'button', 'data-act': 'indent', disabled: i === 0, title: 'Indenter (en faire une sous-tâche)' }, icon('indent')),
              h('button', { class: 'btn sm danger', type: 'button', 'data-act': 'remove', title: 'Supprimer' }, icon('trash')))
          : null,
        it.children.length ? h('ul', { class: 'ed-children' }, renderItems(it.children, depth + 1)) : null);
    });
  }

  function renderTree() {
    tree.replaceChildren(...renderItems(data.items, 0));
    emptyHint.hidden = data.items.length > 0;
    launchBtn.disabled = !data.items.length;
  }

  /* --- Événements de l'arbre (délégation) --- */
  tree.addEventListener('input', (e) => {
    if (!e.target.matches('.ed-input')) return;
    const loc = locate(data.items, e.target.dataset.id);
    if (loc) {
      loc.item.text = e.target.value;
      scheduleSave();
    }
  });

  tree.addEventListener('keydown', (e) => {
    if (!e.target.matches('.ed-input')) return;
    const itemId = e.target.dataset.id;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      apply(e.shiftKey ? 'addChild' : 'addAfter', itemId);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      apply(e.shiftKey ? 'outdent' : 'indent', itemId);
    } else if (e.key === 'Backspace' && e.target.value === '' && !locate(data.items, itemId).item.children.length) {
      e.preventDefault();
      apply('remove', itemId);
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      apply('up', itemId);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      apply('down', itemId);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const inputs = [...tree.querySelectorAll('.ed-input')];
      const next = inputs[inputs.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  });

  tree.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const itemId = btn.closest('.ed-item').dataset.id;
    const act = btn.dataset.act;
    if (act === 'toggleActions') {
      openActions = openActions === itemId ? null : itemId;
      renderTree();
      return;
    }
    if (act === 'addChild') {
      apply('addChild', itemId);
      return;
    }
    // Actions de structure : on garde la barre ouverte sur la tâche déplacée
    const focusId = ops[act](itemId);
    if (act === 'remove') {
      if (locate(data.items, itemId)) return; // annulé
      openActions = null;
    }
    scheduleSave();
    renderTree();
    const target = act === 'remove' ? focusId : itemId;
    const row = target && tree.querySelector(`.ed-item[data-id="${target}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  /* --- En-tête --- */
  const titleInput = h('input', {
    class: 'title-input',
    type: 'text',
    value: data.title,
    placeholder: 'Nom de la checklist',
    maxlength: '200',
    oninput: (e) => {
      data.title = e.target.value;
      scheduleSave();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (data.items.length) focusItem(data.items[0].id);
        else addRoot();
      }
    },
  });

  const descInput = h('textarea', {
    class: 'desc-input',
    rows: 1,
    placeholder: 'Description (facultatif)',
    maxlength: '1000',
    oninput: (e) => {
      data.description = e.target.value;
      autoGrow(e.target);
      scheduleSave();
    },
  });
  descInput.value = data.description || '';

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function addRoot() {
    const it = newItem();
    data.items.push(it);
    scheduleSave();
    renderTree();
    focusItem(it.id);
  }

  async function launch() {
    await save();
    try {
      const r = await api('POST', `/api/checklists/${id}/runs`);
      location.hash = `#/run/${r.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  }

  const launchBtn = h('button', { class: 'btn primary', type: 'button', onclick: launch }, icon('play'), h('span', { class: 'hide-xs' }, 'Lancer'));
  const emptyHint = h('p', { class: 'muted center' }, 'Ajoute ta première tâche ci-dessous.');

  $app.replaceChildren(
    topbar({ back: '#/', title: 'Modifier', actions: [status, launchBtn] }),
    h('main', { class: 'container editor' },
      titleInput,
      descInput,
      emptyHint,
      tree,
      h('button', { class: 'btn add-root', type: 'button', onclick: addRoot }, icon('plus'), 'Ajouter une tâche'),
      h('p', { class: 'muted small kbd-help' },
        'Raccourcis : Entrée = nouvelle tâche · Maj+Entrée = sous-tâche · Tab / Maj+Tab = indenter / désindenter · Alt+↑/↓ = déplacer · Retour arrière sur une tâche vide = supprimer')));

  renderTree();
  requestAnimationFrame(() => autoGrow(descInput));
  if (isNew) {
    history.replaceState(null, '', `#/edit/${id}`);
    titleInput.focus();
    titleInput.select();
  }
}

/* ================= Session (checklist lancée) ================= */

async function viewRun(id) {
  let run = await api('GET', `/api/runs/${id}`);
  const collapsedKey = `collapsed:${id}`;
  let collapsed;
  try {
    collapsed = new Set(JSON.parse(localStorage.getItem(collapsedKey) || '[]'));
  } catch {
    collapsed = new Set();
  }
  const saveCollapsed = () => {
    try {
      localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
    } catch {}
  };

  // Les requêtes sont numérotées : on n'applique que la réponse la plus récente.
  let seq = 0;
  let pending = 0;

  async function mutate(localChange, request) {
    localChange();
    render();
    const mySeq = ++seq;
    pending++;
    try {
      const fresh = await request();
      if (mySeq === seq) {
        run = fresh;
        render();
      }
    } catch (err) {
      toast(err.message, true);
      try {
        run = await api('GET', `/api/runs/${id}`);
        render();
      } catch {}
    } finally {
      pending--;
    }
  }

  function toggle(itemId, checked) {
    mutate(
      () => {
        const { item } = locate(run.items, itemId);
        item.checked = checked;
        setAll(item.children, checked);
        normalize(run.items);
      },
      () => api('POST', `/api/runs/${id}/toggle`, { itemId, checked })
    );
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function checkAll(checked) {
    mutate(() => setAll(run.items, checked), () => api('POST', `/api/runs/${id}/set-all`, { checked }));
  }

  function finish(finished) {
    mutate(
      () => (run.finishedAt = finished ? new Date().toISOString() : null),
      () => api('POST', `/api/runs/${id}/finish`, { finished })
    );
    if (finished) {
      toast('Session archivée');
      location.hash = '#/';
    }
  }

  async function remove() {
    if (!confirm('Supprimer cette session ?')) return;
    try {
      await api('DELETE', `/api/runs/${id}`);
      location.hash = '#/';
    } catch (err) {
      toast(err.message, true);
    }
  }

  function setCollapsedAll(collapse) {
    const walk = (items) =>
      items.forEach((it) => {
        if (it.children.length) {
          collapse ? collapsed.add(it.id) : collapsed.delete(it.id);
          walk(it.children);
        }
      });
    walk(run.items);
    saveCollapsed();
    render();
  }

  /* --- Rendu --- */
  const progressWrap = h('div', { class: 'run-progress' });
  const banner = h('div', {});
  const list = h('ul', { class: 'run-tree' });

  function renderItems(items) {
    return items.map((it) => {
      const hasKids = it.children.length > 0;
      const isCollapsed = hasKids && collapsed.has(it.id);
      const stats = hasKids ? leafStats(it.children) : null;
      const cb = h('input', { type: 'checkbox', checked: it.checked, 'data-id': it.id });
      cb.indeterminate = hasKids && !it.checked && anyChecked(it.children);
      return h('li', { class: 'run-item' + (it.checked ? ' done' : '') },
        h('div', { class: 'run-row' },
          hasKids
            ? h('button', {
                class: 'chevron' + (isCollapsed ? '' : ' open'),
                type: 'button',
                'data-collapse': it.id,
                'aria-label': isCollapsed ? 'Déplier' : 'Replier',
                'aria-expanded': String(!isCollapsed),
              }, icon('chevron'))
            : h('span', { class: 'chevron-spacer' }),
          h('label', { class: 'run-label' },
            cb,
            h('span', { class: 'box' }, icon('check')),
            h('span', { class: 'run-text' }, it.text),
            stats ? h('span', { class: 'sub-count' }, `${stats.done}/${stats.total}`) : null)),
        hasKids && !isCollapsed ? h('ul', { class: 'run-children' }, renderItems(it.children)) : null);
    });
  }

  function render() {
    const { done, total } = leafStats(run.items);
    const complete = total > 0 && done === total;
    progressWrap.replaceChildren(
      h('div', { class: 'run-progress-text' },
        h('span', {}, complete ? 'Tout est fait !' : `${done} sur ${total} terminée${done > 1 ? 's' : ''}`),
        h('strong', {}, `${total ? Math.round((done / total) * 100) : 0} %`)),
      progressBar(done, total));

    if (run.finishedAt) {
      banner.replaceChildren(
        h('div', { class: 'banner' },
          h('span', {}, `Archivée le ${fmtDate(run.finishedAt)}`),
          h('button', { class: 'btn sm', type: 'button', onclick: () => finish(false) }, 'Réactiver')));
    } else if (complete) {
      banner.replaceChildren(
        h('div', { class: 'banner success' },
          h('span', {}, '🎉 Checklist terminée !'),
          h('div', { class: 'banner-actions' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => checkAll(false) }, icon('reset'), 'Recommencer'),
            h('button', { class: 'btn sm primary', type: 'button', onclick: () => finish(true) }, icon('archive'), 'Archiver'))));
    } else banner.replaceChildren();

    list.replaceChildren(...renderItems(run.items));
  }

  list.addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox]')) toggle(e.target.dataset.id, e.target.checked);
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-collapse]');
    if (!btn) return;
    const itemId = btn.dataset.collapse;
    collapsed.has(itemId) ? collapsed.delete(itemId) : collapsed.add(itemId);
    saveCollapsed();
    render();
  });

  /* --- Synchronisation entre appareils --- */
  async function poll() {
    if (document.hidden || pending) return;
    const startSeq = seq;
    try {
      const fresh = await api('GET', `/api/runs/${id}`);
      if (startSeq === seq && !pending && fresh.updatedAt !== run.updatedAt) {
        run = fresh;
        render();
      }
    } catch {}
  }
  const pollTimer = setInterval(poll, 4000);
  const onVisible = () => !document.hidden && poll();
  document.addEventListener('visibilitychange', onVisible);
  cleanup = () => {
    clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisible);
  };

  $app.replaceChildren(
    topbar({
      back: '#/',
      title: run.title,
      actions: [
        dropdown([
          { icon: 'check', label: 'Tout cocher', action: () => checkAll(true) },
          { icon: 'reset', label: 'Tout décocher', action: () => checkAll(false) },
          { icon: 'chevron', label: 'Tout déplier', action: () => setCollapsedAll(false) },
          { icon: 'down', label: 'Tout replier', action: () => setCollapsedAll(true) },
          run.finishedAt ? null : { icon: 'archive', label: 'Archiver', action: () => finish(true) },
          { icon: 'edit', label: 'Modifier le modèle', action: () => (location.hash = `#/edit/${run.checklistId}`) },
          { icon: 'trash', label: 'Supprimer la session', danger: true, action: remove },
        ]),
      ],
    }),
    h('main', { class: 'container run' },
      progressWrap,
      banner,
      list,
      h('div', { class: 'run-footer' },
        h('button', { class: 'btn', type: 'button', onclick: () => checkAll(true) }, icon('check'), 'Tout cocher'),
        h('button', { class: 'btn', type: 'button', onclick: () => checkAll(false) }, icon('reset'), 'Tout décocher'))));

  render();
}

router();
