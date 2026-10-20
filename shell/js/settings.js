// Settings sheet: game options (stored by the game in its own prefs file),
// shell options (localStorage), touch layout and keyboard remapping.

import { NEED, PREF, NEED_LABELS, NEED_ORDER, CODE_TO_SCANCODE, SC, prettyKeyName } from "./constants.js";

const isMac = /mac/i.test(navigator.platform) && !(navigator.maxTouchPoints > 1);

export class Settings {
	constructor(root, game, shell, env) {
		this.root = root;
		this.game = game;
		this.shell = shell;
		this.env = env;
		this.openedFromGameScreen = false;
		this.tab = "game";
		this.listening = null;
		this.aaAtBoot = null;

		this.panes = {};
		for (const p of root.querySelectorAll("[data-pane]")) this.panes[p.dataset.pane] = p;

		root.querySelector(".settings-tabs").addEventListener("click", (e) => {
			const b = e.target.closest("[data-tab]");
			if (b) this.showTab(b.dataset.tab);
		});
		root.querySelector("#btnSettingsDone").addEventListener("click", () => this.close());
		root.addEventListener("pointerdown", (e) => { if (e.target === root) this.close(); });

		// While open, keys belong to the sheet (Escape closes it), not the game
		this.keyGuard = (e) => {
			if (this.root.hidden) return;
			if (this.listening) return;		// handled by the capture listener
			if (e.type === "keydown" && e.code === "Escape") { e.preventDefault(); this.close(); }
			const t = e.target;
			const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
			if (!typing && (e.code === "Tab" || e.code === "Enter" || e.code === "Space")) {
				// allow keyboard navigation of the sheet itself
				e.stopImmediatePropagation();
				return;
			}
			e.stopImmediatePropagation();
			if (e.code !== "Tab" && e.code !== "Enter" && e.code !== "Space") e.preventDefault();
		};
		addEventListener("keydown", this.keyGuard, true);
		addEventListener("keyup", this.keyGuard, true);

		this.root.querySelector(".tab-touch").hidden = !env.isTouchDevice;
		// On phones and tablets, only offer key remapping once a keyboard has actually been used
		this.keyboardSeen = !env.isTouchDevice;
		addEventListener("keydown", () => { this.keyboardSeen = true; }, { capture: true, passive: true });
	}

	isClosed() { return this.root.hidden; }

	onGameReady() {
		this.aaAtBoot = this.game.getPref(PREF.Antialiasing);
		if (!this.root.hidden) this.render();
	}

	refresh() { if (!this.root.hidden) this.render(); }

	open(opts = {}) {
		this.openedFromGameScreen = !!opts.fromGameScreen;
		this.root.querySelector(".tab-touch").hidden = !(this.env.isTouchDevice || this.env.touchActive);
		this.root.querySelector(".tab-keys").hidden = !this.keyboardSeen;
		this.root.hidden = false;
		this.showTab(opts.tab || (this.env.touchActive || !this.game.ready ? (this.game.ready ? "game" : "display") : this.tab));
		setTimeout(() => this.root.querySelector("#btnSettingsDone").focus({ preventScroll: true }), 30);
	}

	close() {
		this.stopListening();
		this.root.hidden = true;
		this.game.savePrefs();
		if (this.openedFromGameScreen) {
			this.openedFromGameScreen = false;
			this.game.pulse(NEED.UIBack);		// leave the game's own settings screen too
		}
	}

	showTab(tab) {
		this.tab = tab;
		for (const b of this.root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
		for (const [name, pane] of Object.entries(this.panes)) pane.hidden = name !== tab;
		this.render();
	}

	render() {
		this.stopListening();
		const pane = this.panes[this.tab];
		pane.replaceChildren();
		({
			game: () => this.renderGame(pane),
			display: () => this.renderDisplay(pane),
			touch: () => this.renderTouch(pane),
			keys: () => this.renderKeys(pane),
			about: () => this.renderAbout(pane),
		})[this.tab]();
	}

	/* ------------------------------------------------------------ building blocks */

	group(pane, title) {
		const g = document.createElement("section");
		g.className = "set-group";
		if (title) {
			const h = document.createElement("h3");
			h.textContent = title;
			g.append(h);
		}
		pane.append(g);
		return g;
	}

	row(parent, label, hint) {
		const r = document.createElement("div");
		r.className = "set-row";
		const l = document.createElement("div");
		l.className = "set-label";
		const s = document.createElement("span");
		s.textContent = label;
		l.append(s);
		if (hint) {
			const sm = document.createElement("small");
			sm.textContent = hint;
			l.append(sm);
		}
		r.append(l);
		parent.append(r);
		return r;
	}

	seg(parent, label, hint, options, current, onPick) {
		const r = this.row(parent, label, hint);
		const seg = document.createElement("div");
		seg.className = "seg";
		seg.setAttribute("role", "group");
		seg.setAttribute("aria-label", label);
		for (const [value, text] of options) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = text;
			b.setAttribute("aria-pressed", String(value === current));
			b.addEventListener("click", () => {
				for (const x of seg.children) x.setAttribute("aria-pressed", "false");
				b.setAttribute("aria-pressed", "true");
				onPick(value);
			});
			seg.append(b);
		}
		r.append(seg);
		return r;
	}

	gamePref(parent, label, hint, id, options) {
		const v = this.game.getPref(id);
		return this.seg(parent, label, hint, options, v, (nv) => this.game.setPref(id, nv));
	}

	note(parent, html) {
		const p = document.createElement("p");
		p.className = "set-note";
		p.innerHTML = html;
		parent.append(p);
		return p;
	}

	button(parent, text, cls, onClick) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "btn " + (cls || "");
		b.textContent = text;
		b.addEventListener("click", onClick);
		parent.append(b);
		return b;
	}

	/* ------------------------------------------------------------ panes */

	renderGame(pane) {
		if (!this.game.ready) {
			this.note(pane, "Start the game to change these options. They're saved on this device along with your high scores.");
			return;
		}
		const play = this.group(pane, "Gameplay");
		this.gamePref(play, "Difficulty", "Extreme brings more enemies and less time.", PREF.Extreme, [[0, "Easy"], [1, "Extreme!"]]);
		this.gamePref(play, "Music", null, PREF.Music, [[0, "Off"], [1, "On"]]);
		this.gamePref(play, "Ambient sounds", "Jungle noises, lava and steam.", PREF.Ambient, [[0, "Off"], [1, "On"]]);

		const look = this.group(pane, "Look");
		this.gamePref(look, "HUD", "Compact floats the original gauges over a full-screen view. Classic is the 1998 frame.", PREF.HUDStyle, [[0, "Compact"], [1, "Classic"]]);
		this.gamePref(look, "Shape", "Fill the screen, or keep the original 4:3 picture.", PREF.Force4x3, [[0, "Fill screen"], [1, "4:3"]]);
		this.gamePref(look, "Textures", null, PREF.HQTextures, [[0, "Pixelated"], [1, "Smooth"]]);
		this.gamePref(look, "Fog", null, PREF.Fog, [[0, "Off"], [1, "On"]]);
		this.gamePref(look, "Sky color", null, PREF.WhiteSky, [[0, "Black"], [1, "White"]]);
		this.gamePref(look, "Nano's dentist is", "Fixes the raptor's teeth texture from the 1998 release.", PREF.TeethFix, [[0, "Extinct"], [1, "Alive"]]);
		this.gamePref(look, "Help text on main menu", null, PREF.MenuHelp, [[0, "Off"], [1, "On"]]);
	}

	renderDisplay(pane) {
		const p = this.shell.prefs;
		const screen = this.group(pane, "Screen");
		const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
		if (canFs) {
			const r = this.row(screen, "Fullscreen", "Also: Alt+Enter, or the button in the corner.");
			const b = this.button(r, document.fullscreenElement ? "Exit" : "Enter", "", () => {
				document.querySelector("#btnFullscreen").click();
				setTimeout(() => this.render(), 300);
			});
			b.style.flex = "0 0 auto";
			if (this.env.isTouchDevice) {
				this.seg(screen, "Go fullscreen when I press Play", null, [[false, "Off"], [true, "On"]], p.autoFullscreen, (v) => this.shell.set("autoFullscreen", v));
			}
		} else if (this.env.isIOS) {
			this.note(screen, "Safari on iPhone can't make web pages fullscreen. <strong>Add Nanosaur to your Home Screen</strong> (Share, then Add to Home Screen) and it opens full-screen, and plays offline.");
		}
		this.seg(screen, "Resolution", "Lower it if the game stutters on an older device.", [["fast", "Fast"], ["balanced", "Balanced"], ["auto", "Auto"], ["native", "Sharpest"]], p.resolution, (v) => this.shell.set("resolution", v));

		if (this.game.ready) {
			const aa = this.game.getPref(PREF.Antialiasing);
			const r = this.gamePref(screen, "Antialiasing", "Smooths jagged edges. Applies after a restart.", PREF.Antialiasing, [[0, "Off"], [2, "4×"]]);
			const restart = document.createElement("button");
			restart.className = "link";
			restart.textContent = "Restart now";
			restart.hidden = aa === this.aaAtBoot;
			restart.onclick = () => { this.game.savePrefs(); setTimeout(() => location.reload(), 300); };
			r.querySelector(".set-label").append(restart);
			r.querySelector(".seg").addEventListener("click", () => {
				setTimeout(() => { restart.hidden = this.game.getPref(PREF.Antialiasing) === this.aaAtBoot; }, 0);
			});
		}

		this.seg(screen, "Frame rate", "Battery saver caps the game at 30 frames per second.", [["full", "Smooth"], ["30", "Battery saver"]], p.frameRate, (v) => this.shell.set("frameRate", v));

		const hud = this.group(pane, "Interface");
		this.seg(hud, "HUD size", null, [["s", "Small"], ["m", "Medium"], ["l", "Large"]], p.hudSize, (v) => this.shell.set("hudSize", v));
		this.seg(hud, "Frame rate counter", null, [[false, "Off"], [true, "On"]], p.showFps, (v) => this.shell.set("showFps", v));
		if (navigator.audioSession) {
			this.seg(hud, "Sound with silent mode on", "Play game audio even when the ringer switch is off.", [[false, "Off"], [true, "On"]], p.silentSwitch, (v) => this.shell.set("silentSwitch", v));
		}
	}

	renderTouch(pane) {
		const p = this.shell.prefs;
		const g = this.group(pane, "Controls");
		this.seg(g, "Button size", null, [["s", "Small"], ["m", "Medium"], ["l", "Large"]], p.ctlSize, (v) => this.shell.set("ctlSize", v));
		this.seg(g, "Button visibility", null, [[0.55, "Faint"], [0.85, "Medium"], [1, "Solid"]], nearest(p.ctlAlpha, [0.55, 0.85, 1]), (v) => this.shell.set("ctlAlpha", v));
		this.seg(g, "Jump and fire on the", null, [[false, "Right"], [true, "Left"]], p.lefty, (v) => this.shell.set("lefty", v));
		if (navigator.vibrate) {
			this.seg(g, "Vibrate on button press", null, [[false, "Off"], [true, "On"]], p.haptics, (v) => this.shell.set("haptics", v));
		}
		const help = this.group(pane, "How it works");
		this.note(help, "<strong>Drag anywhere</strong> to run that way; keep your finger down and swing it round to turn, and let go to stop. <strong>Tap anywhere</strong> to jump (tap again in mid-air to double jump); while running, tap with a second finger. Tap next to an egg to pick it up, then carry it into a time portal. Hold the weapon button to go back a weapon.");
		const row = document.createElement("div");
		row.className = "btn-row";
		help.append(row);
		const again = this.button(row, "Show the tips again", "", () => {
			this.shell.set("seenMoveHint", false);
			this.shell.set("seenTouchHelp", false);
			again.textContent = "Tips will show next time";
			again.disabled = true;
		});
	}

	renderKeys(pane) {
		const g = this.group(pane, null);
		if (!this.game.ready) {
			this.note(g, "Start the game to remap keys.");
			return;
		}
		this.note(g, isMac
			? "These are the original Mac keys: <strong>Command</strong> jumps and <strong>Option</strong> picks things up. Click a key to change it, Delete to clear it, Esc to cancel."
			: "These are the original keys: <strong>Alt</strong> jumps and <strong>Ctrl</strong> picks things up. Click a key to change it, Delete to clear it, Esc to cancel.");

		const M = this.game.M;
		const table = document.createElement("table");
		table.className = "keys-table";
		const tbody = document.createElement("tbody");
		table.append(tbody);
		for (const need of NEED_ORDER) {
			const tr = document.createElement("tr");
			const td = document.createElement("td");
			td.textContent = NEED_LABELS[need];
			tr.append(td);
			for (let slot = 0; slot < 2; slot++) {
				const cell = document.createElement("td");
				cell.className = "k";
				const b = document.createElement("button");
				b.type = "button";
				b.className = "key";
				this.paintKey(b, need, slot);
				b.addEventListener("click", () => this.listen(b, need, slot));
				cell.append(b);
				tr.append(cell);
			}
			tbody.append(tr);
		}
		g.append(table);

		const row = document.createElement("div");
		row.className = "btn-row";
		g.append(row);
		this.button(row, "Restore original keys", "", () => {
			M._Web_ResetKeyBindings();
			this.game.savePrefs();
			this.render();
		});
		this.button(row, "Browser-friendly keys", "", () => {
			// Move modifier-key actions onto letters, avoiding browser and OS shortcuts
			M._Web_SetKeyBinding(NEED.Jump, 0, SC.X);
			M._Web_SetKeyBinding(NEED.Jump, 1, 0);
			M._Web_SetKeyBinding(NEED.PickUp, 0, SC.C);
			M._Web_SetKeyBinding(NEED.PickUp, 1, 0);
			this.game.savePrefs();
			this.render();
		});
		this.note(g, "Browser-friendly keys put Jump on <strong>X</strong> and Pick up on <strong>C</strong>, so holding a modifier never triggers browser shortcuts. The mouse works too: left click shoots, right click jumps, middle click picks up. Game controllers are supported: connect one and press a button.");
	}

	renderAbout(pane) {
		const g = this.group(pane, null);
		g.classList.add("about");
		const info = (window.__nanoBuild) || {};
		g.innerHTML = `
			<p><strong>Nanosaur</strong> was made by Pangea Software in 1998: programming by Brian Greenstone, art by Scott Harper, music by Mike Beckett and Jens Nilsson, cinematics by Chris Ashton.</p>
			<p>This web edition runs <a href="https://github.com/jorio/Nanosaur" target="_blank" rel="noopener">Iliyas Jorio's modern version</a> of the original source, compiled to WebAssembly, with touch controls and a compact HUD built from the original artwork.</p>
			<dl>
				<dt>Game version</dt><dd>1.4.5</dd>
				<dt>Web build</dt><dd>${escapeHtml(info.version || "dev")}</dd>
				<dt>Offline play</dt><dd id="aboutOffline">Checking…</dd>
			</dl>
			<p>Nanosaur is © Pangea Software, Inc. and is licensed CC BY-NC-SA 4.0. Fonts: Lilita One and Nunito, SIL Open Font License.</p>
		`;
		const row = document.createElement("div");
		row.className = "btn-row";
		g.append(row);
		const reset = this.button(row, "Erase settings and high scores", "btn-quiet", async () => {
			if (!reset.dataset.armed) {
				reset.dataset.armed = "1";
				reset.textContent = "Tap again to erase everything";
				return;
			}
			try { localStorage.removeItem("nanosaur.shell"); } catch (e) {}
			try { indexedDB.deleteDatabase("/persist"); } catch (e) {}
			setTimeout(() => location.reload(), 250);
		});
		this.checkOffline(g.querySelector("#aboutOffline"));
	}

	async checkOffline(el) {
		let text = "Not saved yet";
		try {
			if (navigator.serviceWorker && navigator.serviceWorker.controller) {
				const keys = await caches.keys();
				const hasData = keys.length && (await Promise.all(keys.map(async (k) => !!(await (await caches.open(k)).match("nanosaur.data"))))).some(Boolean);
				text = hasData ? "Ready — plays without a connection" : "Saving…";
			}
		} catch (e) {}
		el.textContent = text;
	}

	/* ------------------------------------------------------------ key capture */

	paintKey(b, need, slot) {
		const M = this.game.M;
		const sc = M._Web_GetKeyBinding(need, slot);
		const def = M._Web_GetDefaultKeyBinding(need, slot);
		const name = sc ? prettyKeyName(M.UTF8ToString(M._Web_GetScancodeName(sc)), sc, isMac) : "";
		b.textContent = name || "—";
		b.classList.toggle("empty", !sc);
		b.classList.toggle("changed", sc !== def);
		b.classList.remove("listening");
		b.setAttribute("aria-label", `${NEED_LABELS[need]}, key ${slot + 1}: ${name || "none"}`);
	}

	listen(b, need, slot) {
		this.stopListening();
		b.classList.add("listening");
		b.textContent = "Press a key…";
		const handler = (e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.type !== "keydown") return;
			if (e.code === "Escape") { this.stopListening(); return; }
			let sc = CODE_TO_SCANCODE[e.code];
			if (e.code === "Delete" || e.code === "Backspace") sc = 0;
			if (sc === undefined) return;
			this.game.M._Web_SetKeyBinding(need, slot, sc);
			this.game.savePrefs();
			this.stopListening();
			this.render();
		};
		this.listening = { b, need, slot, handler };
		addEventListener("keydown", handler, true);
		addEventListener("keyup", handler, true);
	}

	stopListening() {
		if (!this.listening) return;
		const { b, need, slot, handler } = this.listening;
		removeEventListener("keydown", handler, true);
		removeEventListener("keyup", handler, true);
		this.listening = null;
		if (b.isConnected) this.paintKey(b, need, slot);
	}
}

function nearest(v, list) {
	return list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0]);
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
