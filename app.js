/* Chef on Call: screens. All text from users goes into the page through textContent, never as
   HTML. Rules and figures come from core.js; data and access checks from store.js. */
(function () {
  'use strict';
  const C = window.ChefCore;
  const DEMO_PW = 'chef-demo-2026';

  function memoryStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
  let storage, storageNote = '';
  try { localStorage.setItem('chefoncall.probe', '1'); localStorage.removeItem('chefoncall.probe'); storage = localStorage; }
  catch (e) { storage = memoryStorage(); storageNote = 'This browser is blocking storage, so the demo resets when you leave the page.'; }
  const S = window.ChefStore.createStore({ storage });

  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  let flash = null;

  /* h('tag.class', {attr}, ...children). Strings become text nodes. */
  function h(spec, attrs, ...kids) {
    const [tag, ...cls] = spec.split('.');
    const el = document.createElement(tag || 'div');
    if (cls.length) el.className = cls.join(' ');
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  let uid = 0;
  function field(label, name, opts = {}) {
    const { type = 'text', value = '', hint, errors = {}, options, attrs = {} } = opts;
    const id = attrs.id || 'f-' + name + '-' + (++uid);
    let control;
    if (type === 'select') {
      control = h('select', { id, name, ...attrs }, options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: String(v) === String(value) || null }, l);
      }));
    } else if (type === 'textarea') {
      control = h('textarea', { id, name, ...attrs }, value);
    } else {
      control = h('input', { id, name, type, value, ...attrs });
    }
    if (errors[name]) control.setAttribute('aria-invalid', 'true');
    return h('div.field', {}, h('label', { for: id }, label), control,
      hint ? h('p.hint', {}, hint) : null, errors[name] ? h('p.error', {}, errors[name]) : null);
  }

  const formData = form => Object.fromEntries(new FormData(form).entries());
  const fmtDate = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } };
  const pillClass = s => (s === 'cancelled' ? 'pill bad' : ['deposit_recorded', 'completed', 'rated'].includes(s) ? 'pill ok' : 'pill');
  const statusPill = s => h('span', { class: pillClass(s) }, C.statusLabel(s));
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
  const say = (text, bad) => { flash = { text, bad }; };

  // ---------- navigation ----------
  function renderNav(route) {
    const me = S.me();
    const link = (href, text) => h('a', { href, 'aria-current': route === href ? 'page' : null }, text);
    const items = [];
    if (!me) items.push(link('#/login', 'Log in'), link('#/register/client', 'Book a chef'), link('#/register/chef', 'Join as a chef'));
    else {
      items.push(link('#/bookings', 'Bookings'));
      if (me.role === 'chef') items.push(link('#/profile', 'My profile'));
      if (me.role === 'admin') items.push(link('#/admin/chefs', 'Chefs'), link('#/admin/users', 'Users'));
      items.push(h('button.link-btn', { type: 'button', onclick: () => { S.logout(); say('You are logged out.'); go('#/'); } }, 'Log out'));
    }
    nav.replaceChildren(...items);
  }

  // ---------- screens ----------
  function home() {
    const me = S.me();
    return [
      h('h1', {}, 'Chef on Call'),
      h('p.lede', {}, 'Book a private chef for a birthday, a family lunch or a wedding. Tell us the date, the guests and the food; we match you with an approved chef.'),
      me ? h('div.btn-row', {}, h('a.btn', { href: '#/bookings' }, 'Go to my bookings'))
         : h('div.btn-row', {}, h('a.btn', { href: '#/register/client' }, 'Book a chef'),
             h('a.btn.secondary', { href: '#/register/chef' }, 'Join as a chef')),
      h('h2', {}, 'How it works'),
      h('ol', {},
        h('li', {}, 'You register and send a booking request: date, guests, cuisine, dietary needs and the equipment at the venue.'),
        h('li', {}, 'Chef on Call offers your booking to a suitable approved chef, who accepts or declines.'),
        h('li', {}, 'You pay the chef a 50% deposit directly (EFT, M-Pesa or cash). Chef on Call records it; it never holds your money.'),
        h('li', {}, 'After the event you rate the chef.')),
      demoLogins(),
    ];
  }

  function demoLogins() {
    return h('div.card.demo-logins', {},
      h('h2', {}, 'Demo logins'),
      h('p', {}, 'Every demo account uses the password ', h('code', {}, DEMO_PW), '.'),
      h('ul', {},
        h('li', {}, h('code', {}, 'admin@example.com'), ' runs the service: matches chefs, records deposits, approves chefs'),
        h('li', {}, h('code', {}, 'client1@example.com'), ' to ', h('code', {}, 'client3@example.com'), ' book chefs'),
        h('li', {}, h('code', {}, 'chef1@example.com'), ' to ', h('code', {}, 'chef3@example.com'), ' are approved chefs; ', h('code', {}, 'chef4@example.com'), ' is waiting for approval')),
      storageNote ? h('p.error', {}, storageNote) : null);
  }

  function loginView() {
    let errorEl = h('p.error', { role: 'alert' });
    const form = h('form', { novalidate: true, onsubmit: async ev => {
      ev.preventDefault();
      const d = formData(form);
      if (await S.login(d.email, d.password)) { say('Welcome back.'); go('#/bookings'); }
      else errorEl.textContent = 'That email and password do not match an account.';
    } },
      field('Email', 'email', { type: 'email', attrs: { autocomplete: 'username', required: true } }),
      field('Password', 'password', { type: 'password', attrs: { autocomplete: 'current-password', required: true } }),
      errorEl,
      h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Log in')));
    return [h('h1', {}, 'Log in'), h('div.card', {}, form),
      h('p', {}, 'New here? ', h('a', { href: '#/register/client' }, 'Book a chef'), ' or ', h('a', { href: '#/register/chef' }, 'join as a chef'), '.'),
      demoLogins()];
  }

  function registerView(role, values = {}, errors = {}) {
    const isChef = role === 'chef';
    const v = values;
    const submit = async ev => {
      ev.preventDefault();
      const d = formData(form);
      if (isChef) d.cuisines = [...form.querySelectorAll('input[name="cuisines"]:checked')].map(x => x.value);
      if (!isChef) d.guardianConsent = !!form.querySelector('input[name="guardianConsent"]:checked');
      const r = await S.register(role, d, d.password);
      if (r.ok) { say(isChef ? 'Your chef profile is in. An administrator will approve it before bookings are offered to you.' : 'Your account is ready. Send your first booking request.'); go(isChef ? '#/profile' : '#/bookings'); }
      else show(registerView(role, { ...d, password: '' }, r.errors));
    };
    const guardian = h('div', { id: 'guardian', hidden: !(Number(v.age) >= 1 && Number(v.age) < 18) || null },
      h('p.hint', {}, 'Under 18: a parent or guardian must agree to this booking.'),
      field('Parent or guardian name', 'guardianName', { value: v.guardianName, errors }),
      h('div.field', {}, h('label.check', {}, h('input', { type: 'checkbox', name: 'guardianConsent', checked: v.guardianConsent }),
        'My parent or guardian consents'), errors.guardianConsent ? h('p.error', {}, errors.guardianConsent) : null));
    const form = h('form', { novalidate: true, onsubmit: submit },
      h('div.two', {}, field('First name', 'firstName', { value: v.firstName, errors, attrs: { autocomplete: 'given-name' } }),
        field('Last name', 'lastName', { value: v.lastName, errors, attrs: { autocomplete: 'family-name' } })),
      field('Email', 'email', { type: 'email', value: v.email, errors, attrs: { autocomplete: 'email' } }),
      field('Contact number', 'phone', { type: 'tel', value: v.phone, errors, attrs: { autocomplete: 'tel' } }),
      isChef ? [
        field(isChef ? 'Area you work in' : 'Area', 'area', { value: v.area, errors, hint: 'Suburb or town, for example Midrand' }),
        h('fieldset.field', {}, h('legend', {}, 'Cuisines you cook'),
          h('div.checks', {}, C.CUISINES.map(c => h('label.check', {}, h('input', { type: 'checkbox', name: 'cuisines', value: c,
            checked: (v.cuisines || []).includes(c) }), c))), errors.cuisines ? h('p.error', {}, errors.cuisines) : null),
        field('Years of experience', 'experienceYears', { type: 'number', value: v.experienceYears, errors, attrs: { min: 0, max: 60, inputmode: 'numeric' } }),
        field('About you', 'bio', { type: 'textarea', value: v.bio, errors, hint: 'Optional. Events you have cooked for, training, specialities.' }),
      ] : [
        field('Age', 'age', { type: 'number', value: v.age, errors, attrs: { min: 1, max: 120, inputmode: 'numeric',
          oninput: e => { const a = Number(e.target.value); guardian.hidden = !(a >= 1 && a < 18); } } }),
        guardian,
        field('Address', 'address', { value: v.address, errors, attrs: { autocomplete: 'street-address' } }),
        field('Area', 'area', { value: v.area, errors, hint: 'Suburb or town, for example Midrand' }),
      ],
      field('Password', 'password', { type: 'password', errors, hint: 'At least 8 characters', attrs: { autocomplete: 'new-password' } }),
      h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Create account')));
    return [h('h1', {}, isChef ? 'Join as a chef' : 'Book a chef: create your account'),
      h('p.lede', {}, isChef ? 'Tell clients what you cook. An administrator approves new chefs before bookings are offered to them.'
        : 'One account for all your bookings.'),
      Object.keys(errors).length ? h('p.notice.bad', { role: 'alert' }, 'Please fix the highlighted fields.') : null,
      h('div.card', {}, form)];
  }

  function bookingCard(b, me) {
    return h('li', {}, h('a.card', { href: '#/booking/' + b.id },
      h('div.row', {}, h('strong', {}, fmtDate(b.date) + ', ' + b.time), statusPill(b.status)),
      h('p.meta', {}, b.cuisine + ' for ' + b.headcount + ' guests in ' + b.area),
      me.role !== 'client' ? h('p.meta', {}, 'Client: ' + b.clientName) : null,
      b.chefName ? h('p.meta', {}, 'Chef: ' + b.chefName) : null));
  }

  function bookingsView() {
    const me = S.me();
    if (!me) return loginView();
    const list = S.myBookings();
    const out = [];
    if (me.role === 'client') {
      out.push(h('h1', {}, 'My bookings'), h('div.btn-row', {}, h('a.btn', { href: '#/bookings/new' }, 'New booking request')));
      out.push(list.length ? h('ul.list', {}, list.map(b => bookingCard(b, me))) : h('p.card', {}, 'No bookings yet. Send your first request.'));
    } else if (me.role === 'chef') {
      const p = me.profile;
      out.push(h('h1', {}, 'My jobs'));
      if (p.status !== 'approved') out.push(h('p.notice.bad', {}, p.status === 'pending' ? 'Your profile is waiting for approval. Bookings are offered to approved chefs only.' : 'Your profile is suspended. Contact Chef on Call.'));
      const offers = list.filter(b => b.status === 'matched' && b.chefId === me.id);
      const rest = list.filter(b => !offers.includes(b));
      out.push(h('h2', {}, 'Waiting for your answer (' + offers.length + ')'),
        offers.length ? h('ul.list', {}, offers.map(b => bookingCard(b, me))) : h('p.meta', {}, 'No new offers.'),
        h('h2', {}, 'Your bookings'), rest.length ? h('ul.list', {}, rest.map(b => bookingCard(b, me))) : h('p.meta', {}, 'Nothing yet.'));
    } else {
      const count = s => list.filter(b => b.status === s).length;
      const chefs = S.chefs();
      out.push(h('h1', {}, 'All bookings'),
        h('div.stats', {},
          h('div.stat', {}, h('b', {}, count('requested')), 'need a chef'),
          h('div.stat', {}, h('b', {}, count('matched')), 'waiting for chef'),
          h('div.stat', {}, h('b', {}, count('confirmed')), 'deposit due'),
          h('div.stat', {}, h('b', {}, chefs.filter(c => c.status === 'pending').length), 'chefs to approve')));
      const groups = [['Need a chef', ['requested']], ['In progress', ['matched', 'confirmed', 'deposit_recorded']],
        ['Finished', ['completed', 'rated', 'cancelled']]];
      for (const [title, sts] of groups) {
        const g = list.filter(b => sts.includes(b.status));
        out.push(h('h2', {}, title + ' (' + g.length + ')'), g.length ? h('ul.list', {}, g.map(b => bookingCard(b, me))) : h('p.meta', {}, 'None.'));
      }
    }
    return out;
  }

  function newBookingView(values, errors = {}) {
    const me = S.me();
    if (!me || me.role !== 'client') return [h('h1', {}, 'Booking request'), h('p.card', {}, 'Log in as a client to request a booking.')];
    const v = values || { address: me.profile.address, area: me.profile.area, headcount: '' };
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const form = h('form', { novalidate: true, onsubmit: ev => {
      ev.preventDefault();
      const d = formData(form);
      const r = S.createBooking(d);
      if (r.ok) { say('Request sent. We will offer it to a chef and you will see the status here.'); go('#/booking/' + r.booking.id); }
      else show(newBookingView(d, r.errors));
    } },
      h('div.two', {}, field('Event date', 'date', { type: 'date', value: v.date, errors, attrs: { min: tomorrow } }),
        field('Start time', 'time', { type: 'time', value: v.time, errors })),
      field('Number of guests', 'headcount', { type: 'number', value: v.headcount, errors, attrs: { min: 1, max: 200, inputmode: 'numeric' } }),
      field('Cuisine', 'cuisine', { type: 'select', value: v.cuisine, errors, options: [['', 'Choose a cuisine'], ...C.CUISINES] }),
      field('Dietary requirements', 'dietary', { type: 'textarea', value: v.dietary, errors, hint: 'Allergies, halaal, vegetarian, and so on. Optional.' }),
      field('Cooking equipment at the venue', 'equipment', { type: 'textarea', value: v.equipment, errors, hint: 'For example: gas stove, oven, braai stand. Optional.' }),
      field('Event address', 'address', { value: v.address, errors }),
      field('Area', 'area', { value: v.area, errors }),
      field('Budget (R)', 'budget', { type: 'number', value: v.budget, errors, hint: 'Optional. Helps us offer the right chef.', attrs: { min: 0, inputmode: 'decimal' } }),
      field('Anything else', 'notes', { type: 'textarea', value: v.notes, errors }),
      h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Send request')));
    return [h('h1', {}, 'New booking request'),
      Object.keys(errors).length ? h('p.notice.bad', { role: 'alert' }, 'Please fix the highlighted fields.') : null,
      h('div.card', {}, form)];
  }

  const ACTION_TEXT = { request: 'Booking requested', match: 'Offered to a chef', accept: 'Chef accepted', decline: 'Chef declined',
    recordDeposit: 'Deposit recorded', complete: 'Event marked done', rate: 'Client rated the chef', cancel: 'Cancelled' };

  function bookingView(id) {
    const me = S.me();
    if (!me) return loginView();
    const b = S.getBooking(id);
    if (!b) return [h('h1', {}, 'Booking not found'), h('p', {}, h('a', { href: '#/bookings' }, 'Back to bookings'))];
    const allowed = C.allowedActions(b, me, new Date().toISOString());
    const run = (action, payload, msg) => {
      try { S.act(b.id, action, payload); say(msg); } catch (e) { say(e.message, true); }
      render();
    };
    const out = [h('p', {}, h('a', { href: '#/bookings' }, 'Back to bookings')),
      h('h1', {}, 'Booking for ' + fmtDate(b.date)), h('p', {}, statusPill(b.status))];

    out.push(h('div.card', {}, h('dl.kv', {},
      h('dt', {}, 'When'), h('dd', {}, fmtDate(b.date) + ' at ' + b.time),
      h('dt', {}, 'Guests'), h('dd', {}, String(b.headcount)),
      h('dt', {}, 'Cuisine'), h('dd', {}, b.cuisine),
      h('dt', {}, 'Dietary'), h('dd', {}, b.dietary || 'None given'),
      h('dt', {}, 'Equipment'), h('dd', {}, b.equipment || 'None given'),
      h('dt', {}, 'Where'), h('dd', {}, b.address + ' (' + b.area + ')'),
      b.budget != null ? [h('dt', {}, 'Budget'), h('dd', {}, C.formatRand(b.budget))] : null,
      b.notes ? [h('dt', {}, 'Notes'), h('dd', {}, b.notes)] : null,
      me.role !== 'client' ? [h('dt', {}, 'Client'), h('dd', {}, b.clientName + (me.role === 'admin' || b.status !== 'matched' ? ', ' + b.clientPhone : ''))] : null,
      b.chefName ? [h('dt', {}, 'Chef'), h('dd', {}, b.chefName + (b.status !== 'matched' ? ', ' + b.chefPhone : ''))] : null,
      b.depositAmount != null ? [
        h('dt', {}, 'Agreed price'), h('dd', {}, C.formatRand(b.agreedPrice)),
        h('dt', {}, 'Deposit (50%)'), h('dd', {}, C.formatRand(b.depositAmount) + ', ' + b.depositMethod + ' on ' + fmtDate(b.depositPaidOn))] : null,
      b.rating ? [h('dt', {}, 'Rating'), h('dd', {}, '★'.repeat(b.rating.stars) + ' (' + b.rating.stars + '/5)' + (b.rating.comment ? ': ' + b.rating.comment : ''))] : null)));

    if (b.status === 'confirmed' && me.role !== 'admin') {
      out.push(h('p.notice', {}, 'Deposit: the client pays 50% of the agreed price directly to the chef by EFT, M-Pesa or cash. Chef on Call records it but never holds the money.'));
    }

    if (allowed.includes('match')) {
      const options = S.suggestChefs(b.id);
      const form = h('form', { onsubmit: ev => { ev.preventDefault(); run('match', { chefId: formData(form).chefId }, 'Offered to the chef. They will accept or decline.'); } },
        h('h2', {}, 'Offer to a chef'),
        options.length ? [
          h('p.hint', {}, 'Best matches first: same cuisine, then same area, then rating.' + (b.declinedBy.length ? ' Chefs who declined are left out.' : '')),
          field('Chef', 'chefId', { type: 'select', attrs: { id: 'match-chef' }, options: options.map(c =>
            [c.userId, c.name + ' · ' + c.cuisines.join(', ') + ' · ' + c.area + (c.ratingCount ? ' · ' + c.rating + '★' : '')]) }),
          h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Offer to chef'))]
          : h('p.meta', {}, 'No approved chef is available. Approve one under Chefs.'));
      out.push(h('div.card', {}, form));
    }
    if (allowed.includes('accept')) {
      out.push(h('div.card', {}, h('h2', {}, 'Can you cook this event?'),
        h('div.btn-row', {}, h('button.btn', { type: 'button', onclick: () => run('accept', {}, 'Accepted. The client will pay the deposit to you directly.') }, 'Accept booking'),
          h('button.btn.secondary', { type: 'button', onclick: () => { if (confirm('Decline this booking?')) run('decline', {}, 'Declined. The booking goes back to Chef on Call.'); } }, 'Decline'))));
    }
    if (allowed.includes('recordDeposit')) {
      const preview = h('p', { id: 'deposit-preview', 'aria-live': 'polite' }, 'Deposit (50%): enter the agreed price');
      const update = e => { const n = Number(e.target.value); preview.textContent = n > 0 ? 'Deposit (50%): ' + C.formatRand(C.depositFor(n)) : 'Deposit (50%): enter the agreed price'; };
      const form = h('form', { novalidate: true, onsubmit: ev => { ev.preventDefault(); run('recordDeposit', formData(form), 'Deposit recorded.'); } },
        h('h2', {}, 'Record the deposit'),
        h('p.hint', {}, 'The client paid the chef directly. Record what was agreed and paid; no money moves through Chef on Call.'),
        field('Agreed price (R)', 'agreedPrice', { type: 'number', attrs: { min: 1, inputmode: 'decimal', oninput: update } }),
        preview,
        field('Paid by', 'method', { type: 'select', options: [['', 'Choose'], ...C.DEPOSIT_METHODS] }),
        field('Paid on', 'paidOn', { type: 'date', value: new Date().toISOString().slice(0, 10) }),
        h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Record deposit')));
      out.push(h('div.card', {}, form));
    }
    if (allowed.includes('complete')) {
      out.push(h('div.btn-row', {}, h('button.btn', { type: 'button', onclick: () => run('complete', {}, 'Marked done. The client can now rate the chef.') }, 'Mark event done')));
    }
    if (allowed.includes('rate')) {
      const form = h('form', { onsubmit: ev => { ev.preventDefault(); run('rate', formData(form), 'Thank you for rating your chef.'); } },
        h('h2', {}, 'Rate your chef'),
        field('Stars', 'stars', { type: 'select', value: '5', options: [['5', '5, excellent'], ['4', '4, good'], ['3', '3, fine'], ['2', '2, poor'], ['1', '1, bad']] }),
        field('Comment', 'comment', { type: 'textarea' }),
        h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Send rating')));
      out.push(h('div.card', {}, form));
    }
    if (allowed.includes('cancel')) {
      out.push(h('div.btn-row', {}, h('button.btn.danger', { type: 'button', onclick: () => { if (confirm('Cancel this booking?')) run('cancel', {}, 'Booking cancelled.'); } }, 'Cancel booking')));
    }
    out.push(h('h2', {}, 'History'), h('ol.timeline', {}, b.history.map(x =>
      h('li', {}, (ACTION_TEXT[x.action] || x.action) + ', ' + new Date(x.at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })))));
    return out;
  }

  function profileView(values, errors = {}) {
    const me = S.me();
    if (!me || me.role !== 'chef') return loginView();
    const p = me.profile;
    const v = values || { ...me, ...p };
    const form = h('form', { novalidate: true, onsubmit: ev => {
      ev.preventDefault();
      const d = formData(form);
      d.cuisines = [...form.querySelectorAll('input[name="cuisines"]:checked')].map(x => x.value);
      const r = S.updateChefProfile(d);
      if (r.ok) { say('Profile saved.'); render(); } else show(profileView(d, r.errors));
    } },
      h('div.two', {}, field('First name', 'firstName', { value: v.firstName, errors }), field('Last name', 'lastName', { value: v.lastName, errors })),
      h('p.meta', {}, 'Login email: ' + me.email),
      field('Contact number', 'phone', { type: 'tel', value: v.phone, errors }),
      field('Area you work in', 'area', { value: v.area, errors }),
      h('fieldset.field', {}, h('legend', {}, 'Cuisines you cook'),
        h('div.checks', {}, C.CUISINES.map(c => h('label.check', {}, h('input', { type: 'checkbox', name: 'cuisines', value: c, checked: (v.cuisines || []).includes(c) }), c))),
        errors.cuisines ? h('p.error', {}, errors.cuisines) : null),
      field('Years of experience', 'experienceYears', { type: 'number', value: v.experienceYears, errors }),
      field('About you', 'bio', { type: 'textarea', value: v.bio, errors }),
      h('div.btn-row', {}, h('button.btn', { type: 'submit' }, 'Save profile')));
    const pub = S.chefPublic(me.id);
    return [h('h1', {}, 'My chef profile'),
      h('p', {}, h('span', { class: p.status === 'approved' ? 'pill ok' : 'pill' }, p.status === 'approved' ? 'Approved' : p.status === 'pending' ? 'Waiting for approval' : 'Suspended'),
        pub.ratingCount ? '  ' + pub.rating + '★ from ' + pub.ratingCount + ' rating' + (pub.ratingCount > 1 ? 's' : '') : '  No ratings yet'),
      h('div.card', {}, form)];
  }

  function adminChefsView() {
    const me = S.me();
    if (!me || me.role !== 'admin') return loginView();
    const chefs = S.chefs().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
    const act = (fn, c, msg) => { fn(c.userId); say(msg); render(); };
    return [h('h1', {}, 'Chefs'), h('p.lede', {}, 'Approve new chefs before bookings can be offered to them. Phase 1 has no cooking test; approval is the administrator\'s call.'),
      h('ul.list', {}, chefs.map(c => h('li.card', {},
        h('p', {}, h('strong', {}, c.name + ' — ' + c.status)),
        h('p.meta', {}, c.cuisines.join(', ') + ' · ' + c.area + ' · ' + c.experienceYears + ' years'),
        h('p.meta', {}, c.email + ' · ' + c.phone),
        h('p.meta', {}, c.ratingCount ? c.rating + '★ from ' + c.ratingCount : 'No ratings yet'),
        c.bio ? h('p.meta', {}, c.bio) : null,
        h('div.btn-row', {},
          c.status !== 'approved' ? h('button.btn', { type: 'button', onclick: () => act(S.approveChef, c, c.name + ' approved.') }, 'Approve ' + c.name) : null,
          c.status !== 'suspended' ? h('button.btn.secondary', { type: 'button', onclick: () => act(S.suspendChef, c, c.name + ' suspended.') }, 'Suspend ' + c.name) : null))))];
  }

  function adminUsersView() {
    const me = S.me();
    if (!me || me.role !== 'admin') return loginView();
    const users = S.users();
    const label = { admin: 'Administrator', client: 'Client', chef: 'Chef' };
    return [h('h1', {}, 'Users (' + users.length + ')'),
      h('ul.list', {}, users.map(u => h('li.card', {},
        h('div.row', {}, h('strong', {}, u.firstName + ' ' + u.lastName), h('span.pill', {}, label[u.role])),
        h('p.meta', {}, u.email + (u.phone ? ' · ' + u.phone : '')),
        u.role === 'client' && u.profile ? h('p.meta', {}, 'Age ' + u.profile.age + ' · ' + u.profile.area +
          (u.profile.guardianConsent ? ' · guardian consent: ' + u.profile.guardianName : '')) : null)))];
  }

  // ---------- router ----------
  function show(nodes) {
    main.replaceChildren(...[].concat(nodes).flat(Infinity).filter(Boolean));
  }

  function render() {
    const route = location.hash || '#/';
    renderNav(route);
    let nodes;
    const m = route.match(/^#\/booking\/([\w-]+)$/);
    if (route === '#/' || route === '#') nodes = home();
    else if (route === '#/login') nodes = loginView();
    else if (route === '#/register/client') nodes = registerView('client');
    else if (route === '#/register/chef') nodes = registerView('chef');
    else if (route === '#/bookings') nodes = bookingsView();
    else if (route === '#/bookings/new') nodes = newBookingView();
    else if (m) nodes = bookingView(m[1]);
    else if (route === '#/profile') nodes = profileView();
    else if (route === '#/admin/chefs') nodes = adminChefsView();
    else if (route === '#/admin/users') nodes = adminUsersView();
    else nodes = [h('h1', {}, 'Page not found'), h('p', {}, h('a', { href: '#/' }, 'Go home'))];
    const f = flash; flash = null;
    show([f ? h(f.bad ? 'p.notice.bad' : 'p.notice', { role: 'status' }, f.text) : null, ...[].concat(nodes)]);
    window.scrollTo(0, 0);
  }

  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirm('Reset the demo? Everything you added in this browser is removed and the sample data comes back.')) return;
    await S.reset(DEMO_PW);
    say('Demo data reset.');
    go('#/');
  });
  window.addEventListener('hashchange', render);
  S.ensureSeeded(DEMO_PW).then(render, e => show([h('h1', {}, 'Something went wrong'), h('p', {}, e.message)]));
})();
