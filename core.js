/* Chef on Call: the rules. No DOM, no storage. Loaded by the browser as window.ChefCore and by
   the tests through require(). Every figure the app shows or saves comes from here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChefCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DEPOSIT_METHODS = ['EFT', 'M-Pesa', 'Cash'];
  const CUISINES = ['African', 'Braai', 'Cape Malay', 'Indian', 'Italian', 'Asian', 'Vegetarian', 'Pastry and baking'];

  const str = v => (v == null ? '' : String(v)).trim();
  const int = v => (/^-?\d+$/.test(str(v)) ? parseInt(str(v), 10) : NaN);

  function required(src, out, errors, fields) {
    for (const [f, label] of fields) {
      out[f] = str(src[f]);
      if (!out[f]) errors[f] = label + ' is required';
    }
  }

  function email(src, out, errors) {
    out.email = str(src.email).toLowerCase();
    if (!out.email) errors.email = 'Email is required';
    else if (!EMAIL_RE.test(out.email)) errors.email = 'Enter a valid email address';
  }

  const result = (value, errors) => ({ ok: Object.keys(errors).length === 0, value, errors });

  /* The service runs on South African time (UTC+2, no daylight saving), so "today" is the SAST date
     whatever the browser's clock or the test machine's time zone says. */
  const serviceDay = iso => new Date(Date.parse(iso) + 2 * 3600 * 1000).toISOString().slice(0, 10);

  function validateClient(src) {
    const v = {}, e = {};
    required(src, v, e, [['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Contact number'],
      ['address', 'Address'], ['area', 'Area']]);
    email(src, v, e);
    v.age = int(src.age);
    if (str(src.age) === '') e.age = 'Age is required';
    else if (!(v.age >= 1 && v.age <= 120)) e.age = 'Enter your age in whole years';
    v.guardianName = '';
    v.guardianConsent = false;
    if (v.age >= 1 && v.age < 18) {
      v.guardianName = str(src.guardianName);
      v.guardianConsent = src.guardianConsent === true || src.guardianConsent === 'on';
      if (!v.guardianName) e.guardianName = 'Under 18: a parent or guardian must be named';
      if (!v.guardianConsent) e.guardianConsent = 'Under 18: a parent or guardian must consent';
    }
    return result(v, e);
  }

  function validateChef(src) {
    const v = {}, e = {};
    required(src, v, e, [['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Contact number'],
      ['area', 'Area you work in']]);
    email(src, v, e);
    v.cuisines = (Array.isArray(src.cuisines) ? src.cuisines : []).map(str).filter(Boolean);
    if (!v.cuisines.length) e.cuisines = 'Pick at least one cuisine';
    v.experienceYears = int(src.experienceYears);
    if (!(v.experienceYears >= 0 && v.experienceYears <= 60)) e.experienceYears = 'Years of experience, 0 to 60';
    v.bio = str(src.bio).slice(0, 600);
    return result(v, e);
  }

  function validateBooking(src, nowIso) {
    const v = {}, e = {};
    required(src, v, e, [['time', 'Start time'], ['cuisine', 'Cuisine'], ['address', 'Event address'], ['area', 'Area']]);
    v.date = str(src.date);
    const today = serviceDay(nowIso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) e.date = 'Pick the event date';
    else if (v.date <= today) e.date = 'The event must be at least one day away';
    v.headcount = int(src.headcount);
    if (!(v.headcount >= 1 && v.headcount <= 200)) e.headcount = 'Number of guests, 1 to 200';
    v.budget = null;
    if (str(src.budget) !== '') {
      v.budget = Number(str(src.budget));
      if (!Number.isFinite(v.budget) || v.budget < 0) e.budget = 'Budget must be a positive amount';
    }
    v.dietary = str(src.dietary).slice(0, 400);
    v.equipment = str(src.equipment).slice(0, 400);
    v.notes = str(src.notes).slice(0, 600);
    return result(v, e);
  }

  /* 50% deposit (UC10). Recorded, never collected: money moves between client and chef. */
  function depositFor(agreedPrice) {
    return Math.round(Number(agreedPrice) * 50) / 100;
  }

  function newBooking(fields, nowIso) {
    return { ...fields, status: 'requested', chefId: null, declinedBy: [], agreedPrice: null,
      depositAmount: null, depositMethod: null, depositPaidOn: null, rating: null, createdAt: nowIso,
      history: [{ at: nowIso, by: fields.clientId, action: 'request' }] };
  }

  const today = serviceDay;
  /* action: [from statuses, who may do it, to status] */
  const RULES = {
    match:         [['requested'], (b, u) => u.role === 'admin', 'matched'],
    accept:        [['matched'], (b, u) => u.role === 'chef' && u.id === b.chefId, 'confirmed'],
    decline:       [['matched'], (b, u) => u.role === 'chef' && u.id === b.chefId, 'requested'],
    recordDeposit: [['confirmed'], (b, u) => u.role === 'admin', 'deposit_recorded'],
    complete:      [['deposit_recorded'], (b, u) => u.role === 'admin' || (u.role === 'chef' && u.id === b.chefId), 'completed'],
    rate:          [['completed'], (b, u) => u.role === 'client' && u.id === b.clientId, 'rated'],
    /* After the deposit only the administrator can cancel: money has changed hands and is settled outside. */
    cancel:        [['requested', 'matched', 'confirmed', 'deposit_recorded'], (b, u) => u.role === 'admin' ||
                     (u.role === 'client' && u.id === b.clientId && b.status !== 'deposit_recorded'), 'cancelled'],
  };
  const ORDER = Object.keys(RULES);

  function allowedActions(b, user, nowIso = new Date().toISOString()) {
    return ORDER.filter(a => RULES[a][0].includes(b.status) && RULES[a][1](b, user) &&
      !(a === 'complete' && b.date > today(nowIso)));
  }

  function transition(b, action, user, payload, nowIso) {
    const rule = RULES[action];
    if (!rule) throw new Error('Unknown action ' + action);
    if (!rule[1](b, user)) throw new Error('You cannot ' + action + ' this booking: not allowed for your account');
    if (!rule[0].includes(b.status)) throw new Error('A ' + b.status + ' booking cannot be changed with ' + action);
    if (action === 'complete' && b.date > today(nowIso)) throw new Error('The event cannot be marked done before the event date');
    const p = payload || {};
    const n = { ...b, declinedBy: [...(b.declinedBy || [])], history: [...b.history], status: rule[2] };
    if (action === 'match') {
      if (!str(p.chefId)) throw new Error('Pick a chef to match');
      n.chefId = str(p.chefId);
    } else if (action === 'decline') {
      n.declinedBy.push(b.chefId);
      n.chefId = null;
    } else if (action === 'recordDeposit') {
      const price = Math.round(Number(str(p.agreedPrice)) * 100) / 100;
      const errors = {};
      if (!Number.isFinite(price) || price <= 0) errors.agreedPrice = 'Enter the agreed price';
      if (!DEPOSIT_METHODS.includes(p.method)) errors.method = 'Choose the payment method: EFT, M-Pesa or cash';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(p.paidOn))) errors.paidOn = 'Enter the date the deposit was paid';
      if (Object.keys(errors).length) {
        // The message is the first problem; .errors carries one message per field for the form.
        throw Object.assign(new Error(Object.values(errors)[0]), { errors });
      }
      n.agreedPrice = price;
      n.depositAmount = depositFor(price);
      n.depositMethod = p.method;
      n.depositPaidOn = str(p.paidOn);
    } else if (action === 'rate') {
      const stars = int(p.stars);
      if (!(stars >= 1 && stars <= 5)) throw new Error('Give 1 to 5 stars');
      n.rating = { stars, comment: str(p.comment).slice(0, 600) };
    }
    n.history.push({ at: nowIso, by: user.id, action });
    return n;
  }

  function suggestChefs(booking, chefs) {
    const declined = booking.declinedBy || [];
    const area = str(booking.area).toLowerCase();
    const score = c => (c.cuisines.includes(booking.cuisine) ? 2 : 0) + (str(c.area).toLowerCase() === area ? 1 : 0);
    return chefs
      .filter(c => c.status === 'approved' && !declined.includes(c.userId))
      .map(c => ({ c, s: score(c) }))
      .sort((x, y) => y.s - x.s || (y.c.rating || 0) - (x.c.rating || 0))
      .map(x => x.c);
  }

  const STATUS_LABELS = {
    requested: 'Waiting for a chef', matched: 'Chef offered, waiting for reply', confirmed: 'Chef confirmed, deposit due',
    deposit_recorded: 'Deposit paid to chef', completed: 'Event done, please rate', rated: 'Done and rated', cancelled: 'Cancelled',
  };
  /* The labels above are written to the client. The chef and the administrator see the same status
     in their own words: only the client is asked to pay the deposit or to rate. */
  const ROLE_LABELS = {
    chef: { matched: 'Offered to you, please reply', confirmed: 'Confirmed, deposit due to you',
      deposit_recorded: 'Deposit paid to you', completed: 'Event done, waiting for the client\u2019s rating' },
    admin: { confirmed: 'Confirmed, deposit to record', completed: 'Event done, waiting for the client\u2019s rating' },
  };
  const statusLabel = (s, role) => (ROLE_LABELS[role] || {})[s] || STATUS_LABELS[s] || s;

  function formatRand(n) {
    if (n == null) return '';
    return 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return { validateClient, validateChef, validateBooking, depositFor, newBooking, transition, allowedActions,
    suggestChefs, statusLabel, formatRand, serviceDay, DEPOSIT_METHODS, CUISINES };
});
