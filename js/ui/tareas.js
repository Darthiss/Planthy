// Tareas de una sola vez: lista completa, alta y edición.

import { state, cfg, today, byId, put, patch, remove, commit } from '../store.js';
import { newId } from '../merge.js';
import { esc, icon, on, haptic, toast, openSheet, closeSheet, field, readForm } from './dom.js';
import { taskRow } from './hoy.js';

function renderList() {
  const t = today();
  const sorted = (a, b) => (a.from || '9999').localeCompare(b.from || '9999') || (a.order ?? 99) - (b.order ?? 99);
  const tasks = state.db.tasks;
  const now = tasks.filter(k => !k.done && !k.optional && k.from && k.from <= t).sort(sorted);
  const soon = tasks.filter(k => !k.done && !k.optional && (!k.from || k.from > t)).sort(sorted);
  const opt = tasks.filter(k => !k.done && k.optional).sort(sorted);
  const done = tasks.filter(k => k.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const block = (title, list) => (list.length ? `<h3 class="month">${title}</h3><div class="card tasks">${list.map(k => taskRow(k, t)).join('')}</div>` : '');
  return `<div class="sheet-nav"><span></span><b>Tareas</b><button class="link strong" data-act="task-new">Agregar</button></div>
    ${!tasks.length ? '<p class="empty">No hay tareas.</p>' : ''}
    ${block('Para hacer', now)}${block('Más adelante', soon)}${block('Opcionales', opt)}${block('Hechas', done)}`;
}
on('tasks-open', () => openSheet(renderList, { live: true }));

let editing = null;
function renderEdit() {
  const k = editing;
  return `<h2 class="sheet-title">${k.id ? 'Editar tarea' : 'Nueva tarea'}</h2>
    <form class="form" data-submit="task-save">
      ${field('Qué hay que hacer', `<textarea name="title" rows="2" required placeholder="Ej.: Cambiar la maceta">${esc(k.title || '')}</textarea>`)}
      ${field('Desde', `<input type="date" name="from" value="${esc(k.from || '')}">`, 'Vacío: sin fecha.')}
      <label class="check switch-row"><span>Opcional</span><input type="checkbox" switch name="optional" ${k.optional ? 'checked' : ''}></label>
      <div class="btns col"><button class="btn primary big">Guardar</button>${k.id ? '<button type="button" class="btn danger ghost" data-act="task-delete">Borrar tarea</button>' : ''}</div>
    </form>`;
}
on('task-new', () => { editing = { from: today(), optional: false }; openSheet(renderEdit); });
on('task-edit', el => { const k = byId('tasks', el.dataset.id); if (!k) return; editing = { ...k }; openSheet(renderEdit); });
on('task-save', form => {
  const f = readForm(form);
  if (!f.title) return toast('Escribí la tarea.');
  const fields = { title: f.title, from: f.from || null, optional: !!f.optional };
  if (editing.id) patch('tasks', editing.id, fields);
  else put('tasks', { id: newId('k'), order: Math.max(0, ...state.db.tasks.map(k => k.order || 0)) + 1, done: false, createdBy: cfg.who || '', ...fields });
  commit(); haptic(); closeSheet();
  toast(editing.id ? 'Tarea guardada.' : 'Tarea agregada.');
});
on('task-delete', () => {
  const k = byId('tasks', editing.id);
  if (!k) return;
  remove('tasks', k.id); commit(); closeSheet();
  toast('Tarea borrada.', { undo: () => { put('tasks', { ...k }); commit(); } });
});
