'use strict';

const allowed = new Set(['poop', 'flies', 'slime', 'stink']);
const requested = new URLSearchParams(window.location.search).get('asset');
const asset = allowed.has(requested) ? requested : 'poop';
document.body.dataset.asset = asset;
document.getElementById('effect').src = `../assets/effects/${asset}.svg`;
