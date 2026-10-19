// Nanosaur web shell: launcher, loading, game bridge, screens, fullscreen, PWA.

import { NEED, SCREEN, PREF, MENU_ITEMS, HUD_FLAG } from "./constants.js";
import { Hud } from "./hud.js";
import { TouchControls } from "./touch.js";
import { Settings } from "./settings.js";

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ shell prefs */

const SHELL_DEFAULTS = {
	resolution: "auto",		// auto | native | balanced | fast
	frameRate: "full",		// full | 30
	showFps: false,
	autoFullscreen: true,
	ctlSize: "m",			// s | m | l
	ctlAlpha: 0.85,
	lefty: false,
	haptics: true,
	hudSize: "m",			// s | m | l
	silentSwitch: true,		// iOS: play sound even with the ringer switch off
	seenMoveHint: false,
	seenTouchHelp: false,
	macKeyTip: false,
};

export const shell = {
	prefs: { ...SHELL_DEFAULTS },
	load() {
		try { Object.assign(this.prefs, JSON.parse(localStorage.getItem("nanosaur.shell") || "{}")); } catch (e) {}
	},
	save() {
		try { localStorage.setItem("nanosaur.shell", JSON.stringify(this.prefs)); } catch (e) {}
	},
	set(key, value) { this.prefs[key] = value; this.save(); applyShellPrefs(); },
};
shell.load();

/* ------------------------------------------------------------------ environment */

const isTouchDevice = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
const isStandalone = matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export const env = { isTouchDevice, isStandalone, isIOS, canFullscreen, touchActive: isTouchDevice };

/* ------------------------------------------------------------------ game bridge */

export const game = {
	M: null,
	started: false,
	ready: false,
	screen: SCREEN.Boot,
	menuSel: 0,
	hud: null,
	need(id, state) { if (this.ready) this.M._Web_SetVirtualNeed(id, state); },
	pulse(id) { this.need(id, 2); },
	tap(nx, ny) { if (this.ready) this.M._Web_TapAt(nx, ny); },
	swipe(dir) { if (this.ready) this.M._Web_Swipe(dir); },
	stick(x, y, on) { if (this.ready) this.M._Web_SetStick(x, y, on ? 1 : 0); },
	getPref(id) { return this.ready ? this.M._Web_GetPref(id) : -1; },
	setPref(id, v) { if (this.ready) { this.M._Web_SetPref(id, v); layoutHud(); } },
	savePrefs() { if (this.ready) this.M._Web_SavePrefs(); },
	pause() { if (this.ready) this.M._Web_PauseGame(); },
	pauseChoice(c) { if (this.ready) this.M._Web_PauseChoice(c); },
	setName(name, submit) {
		if (this.ready) this.M.ccall("Web_SetHighScoreName", null, ["string", "number"], [name, submit ? 1 : 0]);
	},
	setTouchMode(on) { if (this.ready) this.M._Web_SetTouchMode(on ? 1 : 0); },
	resumeFromQuit() { if (this.ready) this.M._Web_ResumeFromQuit(); },
};

/* ------------------------------------------------------------------ UI singletons */

const stage = $("#stage");
const canvas = $("#canvas");
const launcher = $("#launcher");
const hud = new Hud($("#hud"));
const touch = new TouchControls($("#touch"), game, shell, env);
const settings = new Settings($("#settings"), game, shell, env);

hud.onUpdate((s) => touch.onHud(s));
hud.setTouchLayout(env.touchActive);
hud.keyLabelFor = () => {
	if (!game.ready) return null;
	const M = game.M;
	const sc = M._Web_GetKeyBinding(NEED.PickUp, 0) || M._Web_GetKeyBinding(NEED.PickUp, 1);
	if (!sc) return null;
	const isMac = /mac/i.test(navigator.platform);
	if (isMac && (sc === 226 || sc === 230)) return "Option";
	if (isMac && (sc === 227 || sc === 231)) return "Command";
	const name = M.UTF8ToString(M._Web_GetScancodeName(sc));
	return name.replace(/^Left |^Right /, "");
};

/* ------------------------------------------------------------------ toast / fatal */

let toastTimer = 0;
export function toast(message, action, ms = 4200) {
	const el = $("#toast");
	el.replaceChildren();
	const span = document.createElement("span");
	span.textContent = message;
	el.append(span);
	if (action) {
		const b = document.createElement("button");
		b.className = "link";
		b.textContent = action.label;
		b.onclick = () => { el.hidden = true; action.run(); };
		el.append(b);
	}
	el.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function fatal(message) {
	$("#fatalMsg").textContent = message || "An unexpected error occurred.";
	$("#fatal").hidden = false;
}
window.addEventListener("error", (e) => {
	if (game.started && !game.ready && e.message) fatal(e.message);
});

/* ------------------------------------------------------------------ resolution & frame pacing */

const realDPR = window.devicePixelRatio || 1;
function effectiveDPR() {
	const css = Math.max(1, innerWidth * innerHeight);
	switch (shell.prefs.resolution) {
		case "native":	return realDPR;
		case "balanced": return Math.min(realDPR, 1.5);
		case "fast":	return Math.min(realDPR, 1);
		default: {
			// Auto: crisp, but cap the drawing buffer at ~4.2 megapixels
			const capByPixels = Math.sqrt(4.2e6 / css);
			return Math.max(1, Math.min(realDPR, 2, capByPixels));
		}
	}
}
try {
	Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: effectiveDPR });
} catch (e) { /* not overridable on this browser; native DPR will be used */ }

let fpsFrames = 0, fpsLast = performance.now(), frameParity = 0, busySum = 0, resumedAt = 0;
function waitFrame(resolve) {
	// Time spent in the game's own code since the last frame resumed (CPU + GL submission)
	if (resumedAt) busySum += performance.now() - resumedAt;
	const step = (t) => {
		frameParity ^= 1;
		if (shell.prefs.frameRate === "30" && frameParity) {
			requestAnimationFrame(step);
			return;
		}
		fpsFrames++;
		if (t - fpsLast >= 1000) {
			if (shell.prefs.showFps) {
				const busy = fpsFrames ? busySum / fpsFrames : 0;
				$("#fps").textContent = `${Math.round(fpsFrames * 1000 / (t - fpsLast))} fps · ${busy.toFixed(1)} ms`;
			}
			window.__nanoPerf = { fps: fpsFrames * 1000 / (t - fpsLast), busy: fpsFrames ? busySum / fpsFrames : 0 };
			fpsFrames = 0;
			busySum = 0;
			fpsLast = t;
		}
		resumedAt = performance.now();
		resolve();
	};
	requestAnimationFrame(step);
}

export function applyShellPrefs() {
	const p = shell.prefs;
	stage.style.setProperty("--ui", { s: 0.85, m: 1, l: 1.18 }[p.ctlSize] || 1);
	stage.style.setProperty("--ctl-alpha", p.ctlAlpha);
	touch.setLefty(p.lefty);
	$("#fps").hidden = !p.showFps;
	updateHudScale();
	// Ask SDL to re-read the (possibly capped) device pixel ratio
	window.dispatchEvent(new Event("resize"));
	if (navigator.audioSession) {
		try { navigator.audioSession.type = p.silentSwitch ? "playback" : "auto"; } catch (e) {}
	}
}

const safeProbe = document.createElement("div");
safeProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)";
document.body.append(safeProbe);

function updateHudScale() {
	const h = innerHeight, w = innerWidth;
	const cs = getComputedStyle(safeProbe);
	const safeW = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
	// The game pins its 3D GPS map to the top-right corner of the 3D view. Its size scales with
	// the window height; reserve room so the HUD plaques and buttons don't sit on top of it.
	const gpsH = h * 0.30, gpsW = gpsH;
	stage.style.setProperty("--gps-w", `${Math.round(gpsW)}px`);
	stage.style.setProperty("--gps-h", `${Math.round(gpsH)}px`);

	const mult = { s: 0.68, m: 0.8, l: 0.95 }[shell.prefs.hudSize] || 0.8;
	const byHeight = (h / 480) * mult * (isTouchDevice ? 1.15 : 1);
	// Top row at scale 1: lives 86 + health 292 + time 108 + score 160 + eggs 164, plus gaps
	const byWidth = (w - safeW - gpsW - 40) / 850;
	const scale = Math.max(0.45, Math.min(1.7, byHeight, byWidth));
	stage.style.setProperty("--hud", scale.toFixed(3));
	stage.style.setProperty("--vitals-h", `${Math.round(82 * scale)}px`);
}
addEventListener("resize", updateHudScale);

// With "4:3" picked in the game options, the 3D view is pillarboxed; keep the HUD inside it.
function layoutHud() {
	const hudEl = $("#hud");
	const force43 = game.ready && game.getPref(PREF.Force4x3) === 1;
	const bar = force43 ? Math.max(0, (innerWidth - innerHeight * 4 / 3) / 2) : 0;
	hudEl.style.left = bar ? `${Math.round(bar)}px` : "";
	hudEl.style.right = bar ? `${Math.round(bar)}px` : "";
	const gpsH = innerHeight * 0.30;
	const avail = innerWidth - bar * 2;
	const scale = Math.min(parseFloat(getComputedStyle(stage).getPropertyValue("--hud")) || 1, (avail - gpsH - 40) / 850);
	if (bar) hudEl.style.setProperty("--hud", Math.max(0.45, scale).toFixed(3));
	else hudEl.style.removeProperty("--hud");
}
addEventListener("resize", () => layoutHud());

/* ------------------------------------------------------------------ loading */

const loadFill = $("#loadFill");
const loadMeter = $("#loadMeter");
const btnPlay = $("#btnPlay");
const btnPlayText = $("#btnPlayText");
const note = $("#launcherNote");
let buildInfo = { version: "dev", files: {} };
let wasmBinary = null, dataBinary = null, loadPromise = null;

function setProgress(frac) {
	const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
	loadFill.style.width = pct + "%";
	loadMeter.setAttribute("aria-valuenow", pct);
	// Score slot shows the percentage with the original digit sprites
	const digits = $("#loadDigits");
	const str = String(pct).padStart(8, "0");
	if (digits.childElementCount !== 8) {
		digits.replaceChildren();
		for (let i = 0; i < 8; i++) {
			const img = document.createElement("img");
			img.style.left = `${(263 - i * 16) / 640 * 100}%`;
			img.style.top = `${413 / 480 * 100}%`;
			img.style.width = `${16 / 640 * 100}%`;
			digits.append(img);
		}
	}
	[...digits.children].forEach((img, i) => {
		const d = str[7 - i];
		const src = `hud/digit-${d}.png`;
		if (!img.src.endsWith(src)) img.src = src;
	});
	// Eggs light up as loading progresses (the game's goal: recover all five)
	const eggs = $("#loadEggs");
	if (eggs.childElementCount !== 5) {
		eggs.replaceChildren();
		for (let i = 0; i < 5; i++) {
			const img = document.createElement("img");
			img.src = `hud/egg-${i}.png`;
			img.style.left = `${(463 + i * 29) / 640 * 100}%`;
			img.style.top = `${415 / 480 * 100}%`;
			img.style.width = `${26 / 640 * 100}%`;
			img.style.opacity = "0";
			img.style.transition = "opacity .3s ease, transform .3s ease";
			eggs.append(img);
		}
	}
	[...eggs.children].forEach((img, i) => {
		const lit = pct >= (i + 1) * 20;
		img.style.opacity = lit ? "1" : "0";
		img.style.transform = lit ? "none" : "scale(.6)";
	});
}

async function fetchWithProgress(url, expectedSize, onBytes, cache) {
	const res = await fetch(url, { cache: "no-cache" });
	if (!res.ok) throw new Error(`Couldn't download ${url} (HTTP ${res.status})`);
	if (cache) cache.put(url, res.clone()).catch(() => {});
	const total = Number(res.headers.get("content-length")) || expectedSize || 0;
	if (!res.body || !res.body.getReader) {
		const buf = await res.arrayBuffer();
		onBytes(buf.byteLength, buf.byteLength);
		return buf;
	}
	const reader = res.body.getReader();
	const chunks = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		got += value.byteLength;
		onBytes(got, total);
	}
	const out = new Uint8Array(got);
	let off = 0;
	for (const c of chunks) { out.set(c, off); off += c.byteLength; }
	return out.buffer;
}

function startLoading() {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		try {
			const r = await fetch("build-info.json", { cache: "no-cache" });
			if (r.ok) buildInfo = await r.json();
			window.__nanoBuild = buildInfo;
		} catch (e) {}

		let cache = null;
		try { cache = await caches.open(`nanosaur-${buildInfo.version}`); } catch (e) {}

		const sizes = buildInfo.files || {};
		const wasmSize = sizes["nanosaur.wasm"] || 2e6;
		const dataSize = sizes["nanosaur.data"] || 18.5e6;
		let gotW = 0, gotD = 0;
		const update = () => setProgress((gotW + gotD) / (wasmSize + dataSize));
		const [w, d] = await Promise.all([
			fetchWithProgress("nanosaur.wasm", wasmSize, (g) => { gotW = Math.min(g, wasmSize); update(); }, cache),
			fetchWithProgress("nanosaur.data", dataSize, (g) => { gotD = Math.min(g, dataSize); update(); }, cache),
		]);
		wasmBinary = w;
		dataBinary = d;
		setProgress(1);
		// Pre-cache the remaining shell files once the big downloads are done
		registerServiceWorker();
	})();
	loadPromise.then(() => {
		btnPlay.disabled = false;
		btnPlayText.textContent = "Play";
		if (!note.textContent) note.textContent = isTouchDevice ? "Tap Play to start" : "Press Play, or hit Enter";
	}).catch((err) => {
		btnPlayText.textContent = "Retry";
		btnPlay.disabled = false;
		note.textContent = navigator.onLine === false
			? "You're offline and the game hasn't been saved for offline play yet."
			: `Download failed: ${err.message}`;
		loadPromise = null;
	});
	return loadPromise;
}

/* ------------------------------------------------------------------ boot the game */

function bootGame() {
	if (game.started) return;
	game.started = true;

	// Create and unlock the audio context inside the user gesture; SDL picks it up.
	let audioContext;
	try {
		const AC = window.AudioContext || window.webkitAudioContext;
		audioContext = new AC({ latencyHint: "interactive" });
		audioContext.resume().catch(() => {});
	} catch (e) {}
	if (navigator.audioSession) {
		try { navigator.audioSession.type = shell.prefs.silentSwitch ? "playback" : "auto"; } catch (e) {}
	}

	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

	const M = {
		canvas,
		wasmBinary,
		getPreloadedPackage: () => dataBinary,
		locateFile: (p) => p,
		print: (t) => console.log(t),
		printErr: (t) => console.warn(t),
		SDL3: audioContext ? { audioContext } : {},
		nanoWaitFrame: waitFrame,
		nanoEvent: onGameEvent,
		nanoHUD: (...v) => hud.update(v, game),
		onAbort: (what) => fatal(String(what)),
	};
	game.M = M;
	window.Module = M;

	const s = document.createElement("script");
	s.src = "nanosaur.js";
	s.onerror = () => fatal("Couldn't load nanosaur.js");
	document.body.append(s);

	note.textContent = "Starting…";
	btnPlay.disabled = true;
	btnPlayText.textContent = "Starting…";
}

async function onPlay() {
	if (!wasmBinary || !dataBinary) {
		btnPlay.disabled = true;
		btnPlayText.textContent = "Loading…";
		note.textContent = "";
		startLoading();
		return;
	}
	if (isTouchDevice && shell.prefs.autoFullscreen) enterFullscreen();
	if (launcherMode === "resume") {
		hideLauncher();
		launcherMode = "start";
		game.resumeFromQuit();
		return;
	}
	bootGame();
}

let launcherMode = "start";
function showLauncher(mode) {
	launcherMode = mode;
	launcher.hidden = false;
	launcher.classList.remove("leaving");
	btnPlay.disabled = false;
	btnPlayText.textContent = mode === "resume" ? "Keep playing" : "Play";
	note.textContent = mode === "resume" ? "Thanks for playing! Your settings and high scores are saved." : "";
	setUiForScreen();
}
function hideLauncher() {
	launcher.classList.add("leaving");
	setTimeout(() => { launcher.hidden = true; }, 450);
}

/* ------------------------------------------------------------------ game events */

function onGameEvent(type, a, b) {
	switch (type) {
		case "ready":
			game.ready = true;
			game.setTouchMode(env.touchActive);
			hideLauncher();
			$("#corner").hidden = false;
			applyShellPrefs();
			layoutHud();
			settings.onGameReady();
			maybeShowMacKeyTip();
			break;
		case "screen":
			game.screen = a;
			setUiForScreen();
			updateWakeLock();
			break;
		case "menusel":
			game.menuSel = a;
			updateMenuCaption(true);
			break;
		case "nameentry":
			if (a) openNameEntry(b); else closeNameEntry();
			break;
		case "fullscreen":
			toggleFullscreen();
			break;
		case "quit":
			exitFullscreen();
			showLauncher("resume");
			break;
		case "alert":
			toast(String(a));
			break;
		case "fatal":
			fatal(String(a));
			break;
		case "prefs":
			settings.refresh();
			break;
	}
}

function setUiForScreen() {
	const s = game.screen;
	const inGame = s === SCREEN.Game;
	const paused = s === SCREEN.Paused;
	const launcherUp = !launcher.hidden && !launcher.classList.contains("leaving");

	hud.setVisible((inGame || paused) && !launcherUp);
	touch.setMode(launcherUp ? "off" : inGame ? "game" : s === SCREEN.MainMenu ? "menu"
		: paused ? "pause" : (s === SCREEN.Settings || s === SCREEN.Controls) ? "settings"
		: s === SCREEN.NameEntry ? "off" : "tap");

	$("#pausePanel").hidden = !paused;
	$("#menuCaption").hidden = s !== SCREEN.MainMenu;
	if (s === SCREEN.MainMenu) updateMenuCaption(false);

	$("#corner").hidden = !game.ready || inGame || paused || s === SCREEN.Movie || (s === SCREEN.Help && env.touchActive);
	stage.classList.toggle("hide-cursor", inGame && !env.touchActive);

	// Touch players get the HTML settings sheet instead of the 16px-row in-game page
	if ((s === SCREEN.Settings) && env.touchActive && settings.isClosed()) {
		settings.open({ fromGameScreen: true });
	}
	if (s !== SCREEN.Settings && s !== SCREEN.Controls && settings.openedFromGameScreen) {
		settings.openedFromGameScreen = false;
	}

	// Touch help over the (keyboard-centric) original help image
	$("#touchHelp").hidden = !(s === SCREEN.Help && env.touchActive);

	if (inGame && env.touchActive && !shell.prefs.seenMoveHint) touch.showMoveHint();
}

function updateMenuCaption(animate) {
	const t = $("#menuCaptionText");
	t.textContent = MENU_ITEMS[game.menuSel] || "";
	if (animate) {
		t.classList.remove("swap");
		void t.offsetWidth;
		t.classList.add("swap");
	}
}

$("#pausePanel").addEventListener("click", (e) => {
	const b = e.target.closest("[data-pause]");
	if (!b) return;
	const act = b.dataset.pause;
	if (act === "resume") game.pauseChoice(1);
	else if (act === "quit") {
		if (b.dataset.armed) { game.pauseChoice(2); delete b.dataset.armed; b.textContent = "Quit level"; }
		else { b.dataset.armed = "1"; b.textContent = "Tap again to quit"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Quit level"; }, 2500); }
	}
	else if (act === "settings") settings.open();
});

$("#touchHelp").addEventListener("click", (e) => {
	if (e.target.closest("[data-close]")) {
		$("#touchHelp").hidden = true;
		shell.set("seenTouchHelp", true);
		game.tap(0.5, 0.5);		// leave the help screen
	}
});

/* ------------------------------------------------------------------ name entry */

const nameForm = $("#nameEntry");
const nameInput = $("#nameInput");
function openNameEntry(maxLen) {
	nameInput.maxLength = Math.max(1, Math.min(32, maxLen || 15));
	nameInput.value = "";
	nameForm.hidden = false;
	if (!env.touchActive) setTimeout(() => nameInput.focus(), 50);
}
function closeNameEntry() {
	nameForm.hidden = true;
	nameInput.blur();
}
nameInput.addEventListener("input", () => {
	const clean = nameInput.value.toUpperCase().replace(/[^A-Z0-9 #!?'.:\-]/g, "");
	if (clean !== nameInput.value) nameInput.value = clean;
	game.setName(clean, false);
});
nameForm.addEventListener("submit", (e) => {
	e.preventDefault();
	game.setName(nameInput.value.toUpperCase(), true);
	closeNameEntry();
});
// Keep keystrokes typed into HTML fields away from the game (SDL listens on window)
for (const type of ["keydown", "keyup", "keypress"]) {
	document.addEventListener(type, (e) => {
		const t = e.target;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) e.stopPropagation();
	}, true);
}

/* ------------------------------------------------------------------ fullscreen */

function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
async function enterFullscreen() {
	if (!canFullscreen || isFullscreen()) return;
	const el = document.documentElement;
	try {
		if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
		else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
	} catch (e) { return; }
	try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); } catch (e) {}
	try { if (navigator.keyboard && navigator.keyboard.lock && !env.touchActive) navigator.keyboard.lock(); } catch (e) {}
}
function exitFullscreen() {
	if (!isFullscreen()) return;
	try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
}
function toggleFullscreen() {
	if (isFullscreen()) exitFullscreen();
	else if (canFullscreen) enterFullscreen();
	else if (isIOS) toast("For full-screen play on iPhone, tap Share, then Add to Home Screen.", null, 6000);
}
function onFullscreenChange() {
	document.documentElement.classList.toggle("is-fullscreen", isFullscreen());
	$("#btnFullscreen").setAttribute("aria-label", isFullscreen() ? "Exit fullscreen" : "Enter fullscreen");
	setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);

/* ------------------------------------------------------------------ orientation */

const portraitQuery = matchMedia("(orientation: portrait)");
function checkOrientation() {
	const show = env.touchActive && portraitQuery.matches;
	const el = $("#rotate");
	if (show && el.hidden && game.screen === SCREEN.Game) game.pause();
	el.hidden = !show;
}
portraitQuery.addEventListener ? portraitQuery.addEventListener("change", checkOrientation) : portraitQuery.addListener(checkOrientation);
addEventListener("resize", checkOrientation);

/* ------------------------------------------------------------------ input helpers */

// First touch anywhere switches the UI into touch mode (handles hybrid laptops too)
addEventListener("touchstart", () => {
	if (!env.touchActive) {
		env.touchActive = true;
		game.setTouchMode(true);
		hud.setTouchLayout(true);
		setUiForScreen();
		checkOrientation();
	}
}, { capture: true, passive: true });

// Mouse clicks on the canvas: pick menu icons / settings rows / skip screens
canvas.addEventListener("mousedown", (e) => {
	if (e.button !== 0 || env.touchActive) return;
	const s = game.screen;
	if (s === SCREEN.Game || s === SCREEN.NameEntry) return;
	const r = canvas.getBoundingClientRect();
	game.tap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// macOS: while Command is held, browsers don't deliver keyup for other keys. Command is
// Nano's jump key on Macs, so release anything pressed during the chord when it comes up.
const heldDuringMeta = new Set();
let metaDown = false;
addEventListener("keydown", (e) => {
	if (e.code === "MetaLeft" || e.code === "MetaRight") { metaDown = true; return; }
	if (metaDown) heldDuringMeta.add(e.code);
	if (e.code === "Enter" && !game.started && !btnPlay.disabled && !launcher.hidden) onPlay();
}, true);
addEventListener("keyup", (e) => {
	if (e.code !== "MetaLeft" && e.code !== "MetaRight") { heldDuringMeta.delete(e.code); return; }
	metaDown = false;
	for (const code of heldDuringMeta) {
		window.dispatchEvent(new KeyboardEvent("keyup", { code, key: "", bubbles: true }));
	}
	heldDuringMeta.clear();
}, true);
addEventListener("blur", () => { heldDuringMeta.clear(); metaDown = false; });

// Pause when the tab/app goes to the background, and silence audio meanwhile
document.addEventListener("visibilitychange", () => {
	const ctx = game.M && game.M.SDL3 && game.M.SDL3.audioContext;
	if (document.hidden) {
		if (game.screen === SCREEN.Game) game.pause();
		if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
	} else if (ctx) {
		ctx.resume().catch(() => {});
	}
});
// iOS may leave the context suspended until the next gesture
for (const t of ["touchend", "mousedown", "keydown"]) {
	addEventListener(t, () => {
		const ctx = game.M && game.M.SDL3 && game.M.SDL3.audioContext;
		if (ctx && ctx.state !== "running" && !document.hidden) ctx.resume().catch(() => {});
	}, { capture: true, passive: true });
}

// A controller takes over from the touch buttons until the screen is touched again
addEventListener("gamepadconnected", (e) => {
	toast(`Controller connected${e.gamepad && e.gamepad.id ? ": " + e.gamepad.id.replace(/\s*\(.*$/, "") : ""}`);
	if (env.touchActive) {
		env.touchActive = false;
		game.setTouchMode(false);
		hud.setTouchLayout(false);
		setUiForScreen();
		checkOrientation();
	}
});

// iOS Safari: block pinch-zoom gestures that touch-action doesn't cover
document.addEventListener("gesturestart", (e) => e.preventDefault());

// Keep the screen awake while playing
let wakeLock = null;
async function updateWakeLock() {
	const want = game.ready && !document.hidden && (game.screen === SCREEN.Game || game.screen === SCREEN.MainMenu || game.screen === SCREEN.Movie);
	try {
		if (want && !wakeLock && navigator.wakeLock) {
			wakeLock = await navigator.wakeLock.request("screen");
			wakeLock.addEventListener("release", () => { wakeLock = null; });
		} else if (!want && wakeLock) {
			await wakeLock.release();
			wakeLock = null;
		}
	} catch (e) { wakeLock = null; }
}
document.addEventListener("visibilitychange", updateWakeLock);

function maybeShowMacKeyTip() {
	const isMac = /mac/i.test(navigator.platform) && !isIOS;
	if (!isMac || env.touchActive || shell.prefs.macKeyTip) return;
	shell.set("macKeyTip", true);
	toast("Command jumps, Option picks things up, as on the original Mac version. Remap keys in Settings.", {
		label: "Keyboard settings", run: () => settings.open({ tab: "keys" }),
	}, 9000);
}

/* ------------------------------------------------------------------ corner buttons & launcher */

$("#btnFullscreen").addEventListener("click", toggleFullscreen);
$("#btnLauncherFullscreen").addEventListener("click", toggleFullscreen);
$("#btnSettings").addEventListener("click", () => settings.open());
$("#btnLauncherSettings").addEventListener("click", () => settings.open());
btnPlay.addEventListener("click", onPlay);
if (!canFullscreen && !isIOS) $("#btnLauncherFullscreen").hidden = true;
if (!canFullscreen) $("#btnFullscreen").hidden = !isIOS;

let deferredInstall = null;
addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	deferredInstall = e;
	$("#btnInstall").hidden = false;
});
$("#btnInstall").addEventListener("click", async () => {
	if (deferredInstall) {
		deferredInstall.prompt();
		await deferredInstall.userChoice.catch(() => {});
		deferredInstall = null;
		$("#btnInstall").hidden = true;
	}
});
if (isIOS && !isStandalone) {
	$("#btnInstall").hidden = false;
	$("#btnInstall").addEventListener("click", () => {
		if (!deferredInstall) toast("Tap Share, then Add to Home Screen, to install Nanosaur. It then plays full-screen and offline.", null, 7000);
	});
}

/* ------------------------------------------------------------------ service worker */

let swRegistered = false;
let reloadOnControllerChange = false;
function registerServiceWorker() {
	if (swRegistered || !("serviceWorker" in navigator) || location.protocol === "file:") return;
	swRegistered = true;
	navigator.serviceWorker.register("sw.js").then((reg) => {
		reg.addEventListener("updatefound", () => {
			const nw = reg.installing;
			if (!nw) return;
			nw.addEventListener("statechange", () => {
				if (nw.state === "installed" && navigator.serviceWorker.controller) {
					const prompt = () => toast("A new version of Nanosaur is ready.", {
						label: "Reload", run: () => { reloadOnControllerChange = true; nw.postMessage({ type: "skip-waiting" }); },
					}, 12000);
					if (game.screen === SCREEN.Game || game.screen === SCREEN.Paused) {
						const wait = setInterval(() => {
							if (game.screen !== SCREEN.Game && game.screen !== SCREEN.Paused) { clearInterval(wait); prompt(); }
						}, 2000);
					} else prompt();
				}
			});
		});
	}).catch(() => {});
	navigator.serviceWorker.addEventListener("message", (e) => {
		if (e.data && e.data.type === "precached" && !game.started) {
			note.textContent = isStandalone ? "Ready, and playable offline" : "Saved for offline play";
		}
	});
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (reloadOnControllerChange) {
			reloadOnControllerChange = false;
			location.reload();
		}
	});
}

/* ------------------------------------------------------------------ start */

applyShellPrefs();
checkOrientation();
setProgress(0);
startLoading();
if (navigator.serviceWorker && navigator.serviceWorker.controller) {
	// Already installed: register immediately so updates are noticed early
	registerServiceWorker();
}
