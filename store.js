/* Chef on Call: the demo store. Everything lives in this browser's localStorage, so each visitor
   gets a private copy of the synthetic demo data and nothing is sent anywhere. Access rules are
   enforced here as a server's row-level security would enforce them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ChefStore = factory(root.ChefCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const KEY = 'chefoncall.v1';
  const SESSION = 'chefoncall.session';

  function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  async function hashPw(salt, pw) {
    return hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw)));
  }
  function randomId(prefix) {
    const a = new Uint8Array(8); globalThis.crypto.getRandomValues(a);
    return prefix + '-' + hex(a.buffer);
  }
  function daysFrom(iso, n) {
    const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }

  function createStore({ storage, now = () => new Date().toISOString() }) {
    let db = load();

    function load() {
      try { return JSON.parse(storage.getItem(KEY)) || null; } catch (e) { return null; }
    }
    function save() { storage.setItem(KEY, JSON.stringify(db)); }
    function sessionId() { try { return storage.getItem(SESSION); } catch (e) { return null; } }

    function userById(id) { return db && db.users.find(u => u.id === id); }
    function current() { const id = sessionId(); return id ? userById(id) || null : null; }
    function need(role) {
      const u = current();
      if (!u || u.role !== role) throw new Error('Only a logged-in ' + role + ' can do that');
      return u;
    }
    function profileOf(u) { return u.role === 'client' ? db.clients[u.id] : u.role === 'chef' ? db.chefs[u.id] : null; }
    function publicUser(u) {
      return { id: u.id, role: u.role, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone,
        profile: profileOf(u) ? { ...profileOf(u) } : null };
    }
    function chefView(id) {
      const u = userById(id), p = db.chefs[id];
      const rated = db.bookings.filter(b => b.chefId === id && b.rating);
      const avg = rated.length ? Math.round(rated.reduce((s, b) => s + b.rating.stars, 0) / rated.length * 10) / 10 : 0;
      return { userId: id, email: u.email, name: u.firstName + ' ' + u.lastName, phone: u.phone, ...p,
        rating: avg, ratingCount: rated.length };
    }
    function canSee(b, u) {
      if (!u) return false;
      if (u.role === 'admin') return true;
      if (u.role === 'client') return b.clientId === u.id;
      return b.chefId === u.id; // a chef who declined loses sight of the booking
    }

    async function addUser(role, v, pw, at) {
      const salt = randomId('s');
      const u = { id: randomId('u'), role, email: v.email, firstName: v.firstName, lastName: v.lastName,
        phone: v.phone || '', salt, pwHash: await hashPw(salt, pw), createdAt: at };
      db.users.push(u);
      return u;
    }

    async function seed(pw) {
      const t = now();
      db = { users: [], clients: {}, chefs: {}, bookings: [] };
      await addUser('admin', { email: 'admin@example.com', firstName: 'Demo', lastName: 'Admin' }, pw, t);
      const clients = [];
      for (const [i, first, area] of [[1, 'Lerato', 'Midrand'], [2, 'Sipho', 'Sandton'], [3, 'Anele', 'Soweto']]) {
        const u = await addUser('client', { email: `client${i}@example.com`, firstName: first, lastName: 'Example',
          phone: `+27 72 000 000${i}` }, pw, t);
        db.clients[u.id] = { age: 30 + i, guardianName: '', guardianConsent: false, address: `${i} Demo Street, ${area}`, area };
        clients.push(u);
      }
      const chefs = [];
      for (const [i, first, area, cuisines, yrs, status] of [
        [1, 'Kamo', 'Midrand', ['African', 'Braai'], 8, 'approved'],
        [2, 'Thandi', 'Sandton', ['Italian', 'Pastry and baking'], 5, 'approved'],
        [3, 'Rizwan', 'Soweto', ['Indian', 'Cape Malay'], 11, 'approved'],
        [4, 'Zola', 'Midrand', ['Vegetarian', 'Asian'], 2, 'pending']]) {
        const u = await addUser('chef', { email: `chef${i}@example.com`, firstName: first, lastName: 'Example',
          phone: `+27 72 000 001${i}` }, pw, t);
        db.chefs[u.id] = { area, cuisines, experienceYears: yrs, bio: `Demo chef profile: ${cuisines.join(' and ')} for private events.`, status };
        chefs.push(u);
      }
      const admin = db.users[0];
      const A = { id: admin.id, role: 'admin' };
      const mk = (cl, over) => C.newBooking({ id: randomId('b'), clientId: cl.id, time: '18:00', headcount: 10,
        cuisine: 'African', dietary: '', equipment: 'Gas stove', budget: 4000, address: db.clients[cl.id].address,
        area: db.clients[cl.id].area, notes: 'Synthetic demo booking.', ...over }, t);
      const asChef = u => ({ id: u.id, role: 'chef' });
      const asClient = u => ({ id: u.id, role: 'client' });

      db.bookings.push(mk(clients[0], { date: daysFrom(t, 10), headcount: 14, dietary: 'Two vegetarians' }));
      let b = mk(clients[1], { date: daysFrom(t, 17), cuisine: 'Italian', headcount: 6, budget: 3000 });
      db.bookings.push(C.transition(b, 'match', A, { chefId: chefs[1].id }, t));
      b = C.transition(mk(clients[0], { date: daysFrom(t, 24), cuisine: 'Braai', headcount: 25, budget: 7000 }), 'match', A, { chefId: chefs[0].id }, t);
      b = C.transition(b, 'accept', asChef(chefs[0]), {}, t);
      db.bookings.push(C.transition(b, 'recordDeposit', A, { agreedPrice: 6800, method: 'EFT', paidOn: daysFrom(t, -1) }, t));
      b = C.transition(mk(clients[1], { date: daysFrom(t, -1), cuisine: 'Indian', headcount: 8, budget: 3500 }), 'match', A, { chefId: chefs[2].id }, t);
      b = C.transition(b, 'accept', asChef(chefs[2]), {}, t);
      db.bookings.push(C.transition(b, 'recordDeposit', A, { agreedPrice: 3600, method: 'Cash', paidOn: daysFrom(t, -6) }, t));
      b = C.transition(mk(clients[2], { date: daysFrom(t, -5), cuisine: 'African', headcount: 12, budget: 4500 }), 'match', A, { chefId: chefs[0].id }, t);
      b = C.transition(b, 'accept', asChef(chefs[0]), {}, t);
      b = C.transition(b, 'recordDeposit', A, { agreedPrice: 4500, method: 'M-Pesa', paidOn: daysFrom(t, -12) }, t);
      b = C.transition(b, 'complete', asChef(chefs[0]), {}, t);
      db.bookings.push(C.transition(b, 'rate', asClient(clients[2]), { stars: 5, comment: 'Demo review: the family loved it.' }, t));
      save();
    }

    async function ensureSeeded(pw) { if (!db || !Array.isArray(db.users)) await seed(pw); }

    async function reset(pw) { storage.removeItem(SESSION); await seed(pw); }

    async function register(role, input, password) {
      if (role !== 'client' && role !== 'chef') throw new Error('Unknown role ' + role);
      const r = role === 'client' ? C.validateClient(input) : C.validateChef(input);
      const errors = { ...r.errors };
      if (String(password || '').length < 8) errors.password = 'Use at least 8 characters';
      if (r.value.email && db.users.some(u => u.email === r.value.email)) errors.email = 'That email already has an account. Log in instead.';
      if (Object.keys(errors).length) return { ok: false, errors };
      const v = r.value;
      const u = await addUser(role, v, password, now());
      if (role === 'client') db.clients[u.id] = { age: v.age, guardianName: v.guardianName, guardianConsent: v.guardianConsent, address: v.address, area: v.area };
      else db.chefs[u.id] = { area: v.area, cuisines: v.cuisines, experienceYears: v.experienceYears, bio: v.bio, status: 'pending' };
      save();
      storage.setItem(SESSION, u.id);
      return { ok: true, user: publicUser(u) };
    }

    async function login(email, password) {
      const u = db.users.find(x => x.email === String(email || '').trim().toLowerCase());
      if (!u || (await hashPw(u.salt, String(password || ''))) !== u.pwHash) return false;
      storage.setItem(SESSION, u.id);
      return true;
    }

    function logout() { storage.removeItem(SESSION); }
    function me() { const u = current(); return u ? publicUser(u) : null; }

    function createBooking(input) {
      const u = need('client');
      const r = C.validateBooking(input, now());
      if (!r.ok) return { ok: false, errors: r.errors };
      const b = C.newBooking({ id: randomId('b'), clientId: u.id, ...r.value }, now());
      db.bookings.push(b);
      save();
      return { ok: true, booking: b };
    }

    function decorate(b) {
      const cl = userById(b.clientId);
      const ch = b.chefId ? userById(b.chefId) : null;
      return { ...b, clientName: cl ? cl.firstName + ' ' + cl.lastName : '', clientEmail: cl ? cl.email : '',
        clientPhone: cl ? cl.phone : '', chefName: ch ? ch.firstName + ' ' + ch.lastName : '', chefPhone: ch ? ch.phone : '' };
    }

    function myBookings() {
      const u = current();
      return db.bookings.filter(b => canSee(b, u)).map(decorate).sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    function getBooking(id) {
      const b = db.bookings.find(x => x.id === id);
      return b && canSee(b, current()) ? decorate(b) : null;
    }

    function act(id, action, payload) {
      const u = current();
      const i = db.bookings.findIndex(x => x.id === id);
      if (i < 0 || !canSee(db.bookings[i], u)) throw new Error('Booking not found');
      if (action === 'match') {
        const p = db.chefs[payload && payload.chefId];
        if (!p || p.status !== 'approved') throw new Error('Only an approved chef can be matched');
      }
      if (action === 'accept' && db.chefs[u.id].status !== 'approved') throw new Error('Only an approved chef can accept bookings');
      const n = C.transition(db.bookings[i], action, { id: u.id, role: u.role }, payload, now());
      db.bookings[i] = n;
      save();
      return decorate(n);
    }

    function suggestChefs(id) {
      need('admin');
      const b = db.bookings.find(x => x.id === id);
      return C.suggestChefs(b, Object.keys(db.chefs).map(chefView));
    }

    function chefs() { need('admin'); return Object.keys(db.chefs).map(chefView); }
    function setChefStatus(id, status) {
      need('admin');
      if (!db.chefs[id]) throw new Error('Chef not found');
      db.chefs[id] = { ...db.chefs[id], status };
      save();
    }
    function users() { need('admin'); return db.users.map(publicUser); }

    function updateChefProfile(input) {
      const u = need('chef');
      const r = C.validateChef({ ...input, email: u.email });
      if (!r.ok) return { ok: false, errors: r.errors };
      const v = r.value;
      Object.assign(u, { firstName: v.firstName, lastName: v.lastName, phone: v.phone });
      db.chefs[u.id] = { ...db.chefs[u.id], area: v.area, cuisines: v.cuisines, experienceYears: v.experienceYears, bio: v.bio };
      save();
      return { ok: true };
    }

    function chefPublic(id) {
      const u = current();
      if (!u || (u.role !== 'admin' && u.id !== id)) throw new Error('Log in as that chef or as an administrator');
      return db.chefs[id] ? chefView(id) : null;
    }

    return { ensureSeeded, reset, register, login, logout, me, createBooking, myBookings, getBooking, act,
      suggestChefs, chefs, users, updateChefProfile, chefPublic,
      approveChef: id => setChefStatus(id, 'approved'), suspendChef: id => setChefStatus(id, 'suspended') };
  }

  return { createStore };
});
