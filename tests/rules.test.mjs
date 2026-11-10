// Reglas con plantas de prueba anónimas (el inventario real vive en el repo privado).
// Correr: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstSunday, nthSunday, sundayIndex, addDays, dow, relDay, addMonths, isGrowing } from '../js/dates.js';
import {
  stickResult, isRegularDay, recheckDate, plantStatus, fertPending, todayItems, agenda, notificationFor,
  airePending, fotoPending, birthdaysOn, humidPhrase, statusLabel, doseText, cfgOf,
} from '../js/rules.js';
import { merge, canon, emptyDoc, normalize } from '../js/merge.js';

const doc = (over = {}) => ({
  ...emptyDoc(),
  plants: [
    { id: 'sem', order: 1, name: 'Semanal', group: 'semanal', rule: '3-5cm', fertFrom: '2026-12-01', heatCheck: true, aireSensible: true, t: 1 },
    { id: 'men', order: 2, name: 'Mensual', group: 'mensual', rule: 'fondo', fertFrom: '2026-12-01', t: 1 },
    { id: 'agu', order: 3, name: 'Vaso', group: 'agua', rule: null, fertFrom: '2026-12-01', t: 1 },
    { id: 'nun', order: 4, name: 'Nunca', group: 'mensual', rule: 'fondo', fertFrom: 'nunca', t: 1 },
  ],
  settings: { start: '2026-11-09', labelDose: 10, heat: 32 },
  ...over,
});
let n = 0;
const ev = (plantId, date, type, extra = {}) => ({ id: `e${++n}`, plantId, date, type, t: ++n, ...extra });
const plant = (d, id) => d.plants.find(p => p.id === id);
const fertSince = (d, date) => { for (const p of d.plants) if (p.fertFrom !== 'nunca') p.fertFrom = date; return d; };
const status = (d, id, today, weather) => plantStatus(d, plant(d, id), today, weather);
const kinds = items => Object.fromEntries(items.map(i => [i.plant.id, i.kind]));

test('fechas: domingos del mes', () => {
  assert.equal(firstSunday('2026-11'), '2026-11-01');
  assert.equal(firstSunday('2026-12'), '2026-12-06');
  assert.equal(firstSunday('2027-01'), '2027-01-03');
  assert.equal(nthSunday('2026-11', 3), '2026-11-15');
  assert.equal(sundayIndex('2026-11-15'), 3);
  assert.equal(sundayIndex('2026-11-16'), 0);
  assert.equal(dow('2026-11-09'), 1);
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.ok(isGrowing('2026-10-01') && isGrowing('2027-03-31') && !isGrowing('2027-04-01') && !isGrowing('2026-09-30'));
  assert.equal(relDay('2026-11-18', '2026-11-15'), 'el miércoles');
  assert.equal(relDay('2026-11-15', '2026-11-15'), 'hoy');
});

test('palito: cada regla se cumple desde su profundidad', () => {
  const r = (rule, depth) => stickResult({ rule }, depth);
  assert.deepEqual(['nada', '2cm', '3-5cm', 'mitad', 'todo'].map(d => r('2cm', d)), ['humedo', 'seco', 'seco', 'seco', 'seco']);
  assert.deepEqual(['nada', '2cm', '3-5cm', 'mitad', 'todo'].map(d => r('3-5cm', d)), ['humedo', 'humedo', 'seco', 'seco', 'seco']);
  assert.deepEqual(['nada', '2cm', '3-5cm', 'mitad', 'todo'].map(d => r('mitad', d)), ['humedo', 'humedo', 'humedo', 'seco', 'seco']);
  assert.deepEqual(['nada', '2cm', '3-5cm', 'mitad', 'todo'].map(d => r('fondo', d)), ['humedo', 'humedo', 'humedo', 'humedo', 'seco']);
});

test('calendario fijo: semanal, mensual y agua', () => {
  const s = cfgOf(doc());
  const sem = { group: 'semanal' }, men = { group: 'mensual' }, agu = { group: 'agua' };
  // octubre a marzo: todos los domingos
  for (const d of ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']) assert.ok(isRegularDay(sem, d, s), d);
  assert.ok(!isRegularDay(sem, '2026-11-16', s));
  // abril a septiembre: 1.er y 3.er domingo
  assert.deepEqual(['2027-04-04', '2027-04-11', '2027-04-18', '2027-04-25'].map(d => isRegularDay(sem, d, s)), [true, false, true, false]);
  // mensual: 1.er domingo, todo el año
  assert.deepEqual(['2026-12-06', '2026-12-13', '2027-06-06', '2027-06-20'].map(d => isRegularDay(men, d, s)), [true, false, true, false]);
  // agua: todos los domingos, todo el año
  assert.ok(isRegularDay(agu, '2027-06-13', s) && !isRegularDay(agu, '2027-06-14', s));
  // modo aire en Calor: el semanal pasa a todos los domingos de abril a septiembre; el mensual no cambia
  const calor = { ...s, aire: 'calor' };
  assert.ok(isRegularDay(sem, '2027-04-11', calor) && isRegularDay(sem, '2027-04-25', calor));
  assert.ok(!isRegularDay(men, '2027-04-11', calor));
  assert.ok(!isRegularDay(sem, '2027-04-11', { ...s, aire: 'frio' }));
});

test('nada anterior al inicio del seguimiento queda atrasado', () => {
  const d = doc({ settings: { start: '2026-11-09' } });
  assert.deepEqual(todayItems(d, '2026-11-09'), []);
  assert.deepEqual(todayItems(d, '2026-11-14'), []);
  assert.deepEqual(kinds(todayItems(d, '2026-11-15')), { sem: 'revisar', agu: 'agua' });
  // planta nueva: cuenta desde su alta
  d.plants.push({ id: 'nueva', name: 'Nueva', group: 'semanal', rule: '2cm', fertFrom: 'nunca', since: '2026-11-16', t: 1 });
  assert.equal(status(d, 'nueva', '2026-11-18').kind, 'ok');
  assert.equal(status(d, 'nueva', '2026-11-22').kind, 'revisar');
});

test('lo de hoy: domingo, pendiente al día siguiente y registro', () => {
  const d = doc();
  assert.deepEqual(kinds(todayItems(d, '2026-11-15')), { sem: 'revisar', agu: 'agua' }); // 3.er domingo: mensual no
  assert.deepEqual(kinds(todayItems(d, '2026-12-06')), { sem: 'revisar', men: 'revisar', agu: 'agua', nun: 'revisar' });
  // el lunes sigue pendiente
  const mon = status(d, 'sem', '2026-11-16');
  assert.equal(mon.kind, 'revisar'); assert.equal(mon.due, '2026-11-15'); assert.ok(mon.overdue);
  assert.match(statusLabel(mon, '2026-11-16'), /pendiente desde ayer/);
  // seco → regar → regué → al día
  d.events.push(ev('sem', '2026-11-15', 'palito', { depth: '3-5cm', result: 'seco' }));
  assert.equal(status(d, 'sem', '2026-11-15').kind, 'regar');
  assert.equal(status(d, 'sem', '2026-11-17').kind, 'regar'); // sigue pidiendo riego
  d.events.push(ev('sem', '2026-11-17', 'riego'));
  assert.equal(status(d, 'sem', '2026-11-17').kind, 'ok');
  assert.equal(status(d, 'sem', '2026-11-22').kind, 'revisar'); // domingo siguiente
  // agua
  d.events.push(ev('agu', '2026-11-15', 'agua'));
  assert.equal(status(d, 'agu', '2026-11-15').kind, 'ok');
  assert.equal(status(d, 'agu', '2026-11-22').kind, 'agua');
});

test('re-chequeo semanal: miércoles siguiente, salvo que antes caiga un domingo', () => {
  const d = doc(), s = cfgOf(d), sem = plant(d, 'sem');
  assert.equal(recheckDate(sem, '2026-11-15', s), '2026-11-18'); // domingo → miércoles
  assert.equal(recheckDate(sem, '2026-11-18', s), null); // miércoles → antes cae el domingo 22
  assert.equal(recheckDate(sem, '2026-11-16', s), '2026-11-18'); // lunes → miércoles
  // abril a septiembre: húmedo el miércoles posterior al 1.er domingo → otro miércoles (el 3.er domingo cae después)
  assert.equal(recheckDate(sem, '2027-04-04', s), '2027-04-07');
  assert.equal(recheckDate(sem, '2027-04-07', s), '2027-04-14');
  assert.equal(recheckDate(sem, '2027-04-14', s), null); // el domingo 18 es revisión fija

  d.events.push(ev('sem', '2026-11-15', 'palito', { depth: '2cm', result: 'humedo' }));
  const sun = status(d, 'sem', '2026-11-15');
  assert.equal(sun.kind, 'ok'); assert.equal(sun.recheck, '2026-11-18');
  assert.equal(statusLabel(sun, '2026-11-15'), 'Re-chequeo el miércoles');
  assert.equal(humidPhrase(sem, '2026-11-15', s), 'Dale, te aviso el miércoles.');
  assert.equal(status(d, 'sem', '2026-11-17').kind, 'ok');
  const wed = status(d, 'sem', '2026-11-18');
  assert.equal(wed.kind, 'recheck'); assert.equal(wed.due, '2026-11-18');
  assert.equal(status(d, 'sem', '2026-11-19').kind, 'recheck'); // jueves: sigue pendiente
  assert.equal(status(d, 'sem', '2026-11-22').kind, 'revisar'); // domingo: manda la revisión fija
  // lo hago el miércoles y vuelve a dar húmedo: no hay otro re-chequeo
  d.events.push(ev('sem', '2026-11-18', 'palito', { depth: 'nada', result: 'humedo' }));
  const after = status(d, 'sem', '2026-11-18');
  assert.equal(after.kind, 'ok'); assert.equal(after.recheck, null); assert.equal(after.next, '2026-11-22');
});

test('re-chequeo mensual: 3.er domingo; si vuelve a dar húmedo, espera al mes siguiente', () => {
  const d = doc(), s = cfgOf(d), men = plant(d, 'men');
  assert.equal(recheckDate(men, '2026-12-06', s), '2026-12-20');
  assert.equal(recheckDate(men, '2026-12-20', s), null);
  d.events.push(ev('men', '2026-12-06', 'palito', { depth: 'mitad', result: 'humedo' }));
  assert.equal(status(d, 'men', '2026-12-13').kind, 'ok');
  assert.equal(status(d, 'men', '2026-12-13').recheck, '2026-12-20');
  assert.equal(status(d, 'men', '2026-12-20').kind, 'recheck');
  d.events.push(ev('men', '2026-12-20', 'palito', { depth: 'mitad', result: 'humedo' }));
  assert.equal(status(d, 'men', '2026-12-27').kind, 'ok');
  assert.equal(status(d, 'men', '2026-12-27').next, '2027-01-03');
  assert.match(humidPhrase(men, '2026-12-20', s), /la volvemos a mirar el 3 de enero de 2027/);
});

test('calor: máxima de lunes, martes o miércoles por encima del umbral', () => {
  const d = doc();
  d.events.push(ev('sem', '2026-12-13', 'palito', { depth: 'nada', result: 'humedo' })); // domingo húmedo → re-chequeo mié 16
  d.events.push(ev('sem', '2026-12-16', 'palito', { depth: 'todo', result: 'seco' }), ev('sem', '2026-12-16', 'riego'));
  d.events.push(ev('sem', '2026-12-20', 'riego'));
  const hotMon = { daily: { '2026-12-21': 33.4, '2026-12-22': 30, '2026-12-23': 29 } };
  const mild = { daily: { '2026-12-21': 32, '2026-12-22': 30, '2026-12-23': 31.9 } };
  assert.equal(status(d, 'sem', '2026-12-22', hotMon).kind, 'ok'); // martes: todavía no
  const wed = status(d, 'sem', '2026-12-23', hotMon);
  assert.equal(wed.kind, 'calor'); assert.equal(wed.heatMax, 33.4);
  assert.equal(status(d, 'sem', '2026-12-23', mild).kind, 'ok'); // 32 no supera 32
  assert.equal(status(d, 'sem', '2026-12-23', null).kind, 'ok'); // sin datos de clima no inventa
  assert.equal(status(d, 'men', '2026-12-23', hotMon).kind, 'revisar'); // solo las marcadas: la mensual sigue con lo suyo
  assert.equal(status(d, 'sem', '2026-12-24', hotMon).kind, 'calor'); // jueves: pendiente
  d.events.push(ev('sem', '2026-12-23', 'palito', { depth: 'nada', result: 'humedo' }));
  assert.equal(status(d, 'sem', '2026-12-23', hotMon).kind, 'ok');
  // umbral editable
  d.settings.heat = 28;
  assert.equal(status(d, 'sem', '2026-12-30', { daily: { '2026-12-29': 28.5 } }).kind, 'calor');
  const base = [ev('sem', '2026-12-20', 'riego'), ev('agu', '2026-12-20', 'agua')];
  const n2 = notificationFor({ ...d, events: [...base, ev('sem', '2026-12-20', 'fert')] }, '2026-12-23', mild);
  assert.equal(n2.title, 'Hace calor: máxima de 32 °C'); assert.equal(n2.body, 'Revisá semanal.');
  // si la dosis de diciembre sigue pendiente, el aviso la suma: va en el próximo riego del mes
  assert.equal(notificationFor({ ...d, events: base }, '2026-12-23', mild).body, 'Revisá semanal y 1 con Fertifox.');
});

test('fertilización: 1.er domingo de octubre a marzo, desde la fecha de cada planta', () => {
  const d = fertSince(doc(), '2026-10-01'), s = cfgOf(d);
  const f = (id, date, evs = []) => fertPending(plant(d, id), evs, date, s);
  assert.equal(f('sem', '2026-11-01').kind, 'mensual');
  assert.equal(f('sem', '2026-11-01').dose, '5 ml por litro');
  assert.equal(f('agu', '2026-11-01').dose, '5 gotas en el vaso');
  assert.equal(doseText({ group: 'semanal' }, { labelDose: 5 }), '2,5 ml por litro');
  assert.equal(doseText({ group: 'semanal' }, { labelDose: null }), 'media dosis');
  assert.equal(f('sem', '2026-12-05'), null); // antes del 1.er domingo de diciembre
  assert.equal(f('sem', '2026-12-06').kind, 'mensual');
  assert.equal(f('sem', '2027-04-04'), null); // abril a septiembre: nunca
  assert.equal(f('sem', '2027-09-05'), null);
  assert.equal(f('sem', '2027-10-03').kind, 'mensual');
  // fecha de inicio
  plant(d, 'men').fertFrom = '2026-12-06';
  assert.equal(f('men', '2026-11-01'), null);
  assert.equal(f('men', '2026-11-29'), null);
  assert.equal(f('men', '2026-12-06').kind, 'mensual');
  // nunca es nunca
  for (let ym = '2026-10'; ym < '2029-10'; ym = addMonths(ym, 1)) assert.equal(f('nun', firstSunday(ym)), null, ym);
});

test('fertilización pendiente: va en el próximo riego del mes, no se duplica ni se arrastra', () => {
  const d = fertSince(doc(), '2026-10-01'), s = cfgOf(d), sem = plant(d, 'sem');
  const evs = [ev('sem', '2026-12-06', 'palito', { depth: 'nada', result: 'humedo' })];
  const f = date => fertPending(sem, evs, date, s);
  assert.equal(f('2026-12-09').kind, 'mensual'); // re-chequeo del miércoles: sigue pendiente
  assert.equal(f('2026-12-31').kind, 'mensual'); // hasta fin de mes
  assert.equal(f('2027-01-01'), null); // enero todavía no llegó a su 1.er domingo: la de diciembre se salteó
  assert.equal(f('2027-01-03').kind, 'mensual'); // y la de enero es una sola
  evs.push(ev('sem', '2026-12-09', 'riego'), ev('sem', '2026-12-09', 'fert'));
  assert.equal(f('2026-12-09'), null); // ya está: nunca se duplica en el mes
  assert.equal(f('2026-12-13'), null);
  // marzo no se arrastra a abril
  const marzo = [ev('sem', '2027-03-07', 'palito', { depth: 'nada', result: 'humedo' })];
  assert.equal(fertPending(sem, marzo, '2027-03-31', s).kind, 'mensual');
  assert.equal(fertPending(sem, marzo, '2027-04-01', s), null);
  assert.equal(fertPending(sem, marzo, '2027-04-04', s), null);
});

test('primera dosis pendiente: en el próximo riego, el día que sea; después, el 1.er domingo', () => {
  const d = doc(), s = cfgOf(d);
  const p = { id: 'pri', name: 'Primera', group: 'semanal', rule: '3-5cm', fertFrom: '2026-11-09', firstDose: true };
  assert.equal(fertPending(p, [], '2026-11-08', s), null);
  assert.equal(fertPending(p, [], '2026-11-11', s).kind, 'primera');
  assert.equal(fertPending(p, [], '2026-11-15', s).kind, 'primera');
  const done = [ev('pri', '2026-11-15', 'fert')];
  assert.equal(fertPending(p, done, '2026-11-22', s), null); // noviembre ya no (su 1.er domingo fue antes del inicio)
  assert.equal(fertPending(p, done, '2026-12-06', s).kind, 'mensual');
  // si la primera cae a principio de diciembre, no se repite el 1.er domingo de ese mes
  const dic = [ev('pri', '2026-12-02', 'fert')];
  assert.equal(fertPending(p, dic, '2026-12-06', s), null);
  assert.equal(fertPending(p, dic, '2027-01-03', s).kind, 'mensual');
});

test('agenda: proyecta domingos, re-chequeos, tareas y una dosis por mes', () => {
  const d = doc();
  d.tasks.push({ id: 't1', title: 'Trasplantar', from: '2026-11-23', done: false, t: 1 }, { id: 't2', title: 'Hecha', from: '2026-11-24', done: true, t: 1 });
  d.events.push(ev('sem', '2026-11-15', 'palito', { depth: 'nada', result: 'humedo' }), ev('agu', '2026-11-15', 'agua'));
  const a = agenda(d, '2026-11-15', '2026-12-13');
  const of = date => (a.get(date) || []).map(i => `${i.kind}:${i.plant?.id || i.task?.id || ''}${i.fert ? '+fert' : ''}`);
  assert.deepEqual(of('2026-11-15'), []);
  assert.deepEqual(of('2026-11-18'), ['recheck:sem']);
  assert.deepEqual(of('2026-11-22'), ['revisar:sem', 'agua:agu']);
  assert.deepEqual(of('2026-11-23'), ['tarea:t1']);
  assert.deepEqual(of('2026-11-24'), []);
  assert.deepEqual(of('2026-12-06'), ['revisar:sem+fert', 'revisar:men+fert', 'agua:agu+fert', 'revisar:nun', 'foto:']);
  assert.deepEqual(of('2026-12-13'), ['revisar:sem', 'agua:agu']); // la dosis de diciembre ya se contó el 6
});

test('notificación: resumen accionable y nada si no toca nada', () => {
  const d = doc();
  assert.equal(notificationFor(d, '2026-11-16'), null); // lunes: lo atrasado no vuelve a avisar
  const sun = notificationFor(d, '2026-11-15');
  assert.equal(sun.title, 'Domingo de plantas');
  assert.equal(sun.body, '1 para revisar y cambio de agua.');
  const first = notificationFor(d, '2026-12-06');
  assert.equal(first.title, 'Primer domingo del mes');
  assert.equal(first.body, '3 para revisar, cambio de agua, 3 con Fertifox y foto del mes.');
  d.events.push(ev('sem', '2026-11-15', 'palito', { depth: 'nada', result: 'humedo' }));
  const wed = notificationFor(d, '2026-11-18');
  assert.equal(wed.title, 'Re-chequeo: Semanal');
  assert.equal(wed.body, 'Dio húmedo: pasale el palito hoy.');
  d.tasks.push({ id: 't1', title: 'Trasplantar la de prueba', from: '2026-11-23', done: false, t: 1 });
  assert.deepEqual(notificationFor(d, '2026-11-23'), { title: 'Tarea de plantas', body: 'Trasplantar la de prueba.', count: 1 });
  assert.equal(notificationFor(d, '2026-11-24'), null);
});

test('modo aire: tarjeta semanal de puntas secas solo en Frío o Calor', () => {
  const d = doc();
  assert.equal(airePending(d, '2026-11-15'), null);
  d.settings.aire = 'frio'; d.settings.aireSince = '2026-11-17';
  assert.equal(airePending(d, '2026-11-18'), null); // se activó el martes: la primera tarjeta es el domingo
  const card = airePending(d, '2026-11-22');
  assert.deepEqual(card.plants.map(p => p.id), ['sem']);
  assert.equal(airePending(d, '2026-11-24').overdue, true);
  d.events.push(ev('sem', '2026-11-24', 'puntas', { result: 'bien' }));
  assert.equal(airePending(d, '2026-11-24'), null);
  assert.ok(airePending(d, '2026-11-29'));
});

test('foto del mes y cumpleaños', () => {
  const d = doc();
  assert.equal(fotoPending(d, '2026-12-05'), null);
  assert.equal(fotoPending(d, '2026-12-06').plants.length, 4);
  d.photos.push({ id: 'f1', plantId: 'sem', date: '2026-12-06', t: 1 });
  assert.equal(fotoPending(d, '2026-12-08').plants.length, 3);
  assert.equal(fotoPending(d, '2026-12-13'), null);
  plant(d, 'sem').birthday = '2026-11-09';
  assert.deepEqual(birthdaysOn(d, '2026-11-09'), []);
  assert.equal(birthdaysOn(d, '2027-11-09')[0].years, 1);
  assert.equal(birthdaysOn(d, '2028-11-10').length, 0);
});

test('fusión: gana el más nuevo, los borrados no reviven y el resultado no depende del orden', () => {
  const a = emptyDoc(), b = emptyDoc();
  a.plants.push({ id: 'p1', name: 'Vieja', t: 1 }, { id: 'p2', name: 'Borrada acá', t: 5 });
  b.plants.push({ id: 'p1', name: 'Nueva', t: 2 }, { id: 'p3', name: 'De B', t: 1 });
  b.deleted.p2 = 6;
  a.events.push({ id: 'e2', t: 1 }); b.events.push({ id: 'e1', t: 1 });
  a.settings = { heat: 32, aire: 'frio' }; a.st = { aire: 10 };
  b.settings = { heat: 30, aire: 'apagado' }; b.st = { heat: 20, aire: 5 };
  const ab = merge(a, b), ba = merge(b, a);
  assert.equal(canon(ab), canon(ba));
  assert.deepEqual(ab.plants.map(p => p.name), ['Nueva', 'De B']);
  assert.deepEqual(ab.events.map(e => e.id), ['e1', 'e2']);
  assert.deepEqual(ab.settings, { heat: 30, aire: 'frio' });
  assert.equal(canon(merge(ab, a)), canon(ab)); // estable: fusionar de nuevo no cambia nada
  // re-crear después de borrar (deshacer) gana si es más nuevo que la lápida
  const c = emptyDoc(); c.plants.push({ id: 'p2', name: 'Deshecha', t: 7 });
  assert.ok(merge(ab, c).plants.some(p => p.id === 'p2'));
  assert.equal(normalize({ app: 'otra' }), null);
  assert.deepEqual(normalize({ app: 'planthy', plants: [{ id: 'x' }, null] }).plants, [{ id: 'x' }]);
});
