import { Net } from './net.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const net = new Net();
const state = { player: null, view: { cx: 15, cy: 15, zoom: 1 }, selected: null, placing: null, raidTarget: null, fiesta: null };

const renderer = new Renderer(canvas, state);
const input = new Input(canvas, state, renderer);
const ui = new UI(state, net, renderer);

net.on('state', (s) => { state.player = s; state.fiesta = s.fiesta; ui.refresh(); });
net.on('raided', (m) => { renderer.shake(); ui.toast(`Pintakasi ni ${m.by}! -${m.lootPera}₱ -${m.lootEnergiya}E`); });
net.on('auth', (s) => { state.player = s; state.fiesta = s.fiesta; ui.showGame(); ui.refresh(); });

ui.on('placing', (type) => { state.placing = type; input.enablePlacing(); });
ui.on('cancel', () => { state.placing = null; input.disablePlacing(); });
ui.on('select', (b) => { state.selected = b; });
ui.on('train', (t) => net.train(t));
ui.on('raid', () => ui.openRaid());

function loop(ts) { renderer.render(ts); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
window.addEventListener('resize', () => renderer.resize());
renderer.resize();
