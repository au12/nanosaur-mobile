// Touch controls.
//
// Movement: put a finger down anywhere that isn't a button and push. A stick appears under
// the finger and Nano runs the way you push for as long as you hold it; swing the finger
// round without lifting and he turns with it. Lift the finger and he stops.
//
// Jump: tap anywhere. While you're already running, a second finger tapping anywhere jumps
// immediately. A tap next to an egg picks it up instead.
//
// Built on raw touch events: every event is reconciled against the browser's list of
// fingers actually on the glass, so a lost "touchend" can never leave Nano running.

import { NEED, HUD_FLAG } from "./constants.js";

const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 10;
const STICK_ACTIVATE = 10;
const SWIPE_MIN = 42;
const LONG_PRESS_MS = 450;

export class TouchControls {
	constructor(root, game, shell, env) {
		this.root = root;
		this.game = game;
		this.shell = shell;
		this.env = env;
		this.mode = "off";
		this.touches = new Map();		// identifier -> tracked touch
		this.stickId = null;
		this.held = new Set();			// needs currently held down

		this.stickEl = root.querySelector("#stick");
		this.moveHint = root.querySelector("#moveHint");
		this.weaponBtn = root.querySelector('[data-act="weapon"]');
		this.weaponIcon = root.querySelector("#weaponIcon");
		this.weaponAmmo = root.querySelector("#weaponAmmo");
		this.jet = root.querySelector("#jet");
		this.jetFuel = root.querySelector("#jetFuel");
		this.throwBtn = root.querySelector('[data-act="throw"]');

		const opts = { passive: false };
		root.addEventListener("touchstart", (e) => this.onStart(e), opts);
		root.addEventListener("touchmove", (e) => this.onMove(e), opts);
		root.addEventListener("touchend", (e) => this.onEnd(e, false), opts);
		root.addEventListener("touchcancel", (e) => this.onEnd(e, true), opts);

		// Safety net: when the last finger leaves the glass anywhere, nothing may stay held
		addEventListener("touchend", (e) => { if (e.touches.length === 0 && this.touches.size) this.releaseAll(); });
		addEventListener("touchcancel", (e) => { if (e.touches.length === 0 && this.touches.size) this.releaseAll(); });
		document.addEventListener("visibilitychange", () => { if (document.hidden) this.releaseAll(); });
		addEventListener("blur", () => this.releaseAll());
		addEventListener("pagehide", () => this.releaseAll());

		// Mouse on a hybrid touchscreen laptop: buttons still work with a pointer
		for (const btn of root.querySelectorAll(".tbtn")) {
			btn.addEventListener("pointerdown", (e) => {
				if (e.pointerType !== "mouse") return;
				e.preventDefault();
				this.pressButton("mouse", btn);
				const up = () => { this.releaseButton("mouse", false); removeEventListener("pointerup", up); };
				addEventListener("pointerup", up);
			});
			btn.addEventListener("contextmenu", (e) => e.preventDefault());
		}
	}

	/* ------------------------------------------------------------ mode */

	setMode(mode) {
		if (!this.env.touchActive) mode = "off";
		if (mode === this.mode) return;
		this.releaseAll();
		this.mode = mode;
		this.root.hidden = mode === "off";
		this.root.classList.toggle("in-game", mode === "game");
		const showGame = mode === "game";
		this.root.querySelector(".tcluster-action").hidden = !showGame;
		this.root.querySelector(".tcluster-util").hidden = !showGame;
		this.root.querySelector(".tbtn-pause").hidden = !showGame;
		if (!showGame) this.moveHint.hidden = true;
	}

	setLefty(on) { this.root.classList.toggle("lefty", !!on); }

	showMoveHint() {
		if (this.mode !== "game") return;
		this.moveHint.hidden = false;
		clearTimeout(this.moveHintTimer);
		this.moveHintTimer = setTimeout(() => { this.moveHint.hidden = true; }, 9000);
	}

	hideMoveHint() {
		if (!this.moveHint.hidden) {
			this.moveHint.hidden = true;
			this.shell.set("seenMoveHint", true);
		}
	}

	/* ------------------------------------------------------------ HUD feedback */

	onHud(s) {
		if (this.weaponIcon.dataset.w !== String(s.weapon)) {
			this.weaponIcon.dataset.w = String(s.weapon);
			this.weaponIcon.src = `hud/weapon-${s.weapon}.png`;
		}
		this.weaponAmmo.textContent = String(s.ammo);
		let n = 0;
		for (let i = 0; i < 5; i++) if (s.weaponMask & (1 << i)) n++;
		this.weaponBtn.classList.toggle("only-one", n <= 1);

		const hasJet = !!(s.flags & (HUD_FLAG.HasFuel | HUD_FLAG.Jetting));
		this.jet.hidden = !hasJet;
		const frac = 1 - Math.max(0, Math.min(28, s.fuelFrame - 16)) / 28;
		this.jetFuel.style.height = `${Math.round(frac * 100)}%`;
		if (!hasJet) {
			this.release(NEED.JetUp);
			this.release(NEED.JetDown);
		}

		this.throwBtn.hidden = !(s.flags & HUD_FLAG.Carrying);
	}

	/* ------------------------------------------------------------ needs */

	hold(need) {
		if (!this.held.has(need)) {
			this.held.add(need);
			this.game.need(need, 1);
		}
	}

	release(need) {
		if (this.held.has(need)) {
			this.held.delete(need);
			this.game.need(need, 0);
		}
	}

	releaseAll() {
		for (const n of this.held) this.game.need(n, 0);
		this.held.clear();
		for (const t of this.touches.values()) {
			if (t.btn) t.btn.classList.remove("on");
			if (t.longTimer) clearTimeout(t.longTimer);
		}
		this.touches.clear();
		this.stickId = null;
		this.stickEl.hidden = true;
		this.game.stick(0, 0, false);
	}

	buzz(ms = 8) {
		if (this.shell.prefs.haptics && navigator.vibrate) {
			try { navigator.vibrate(ms); } catch (e) {}
		}
	}

	norm(x, y) {
		const r = this.root.getBoundingClientRect();
		return [(x - r.left) / r.width, (y - r.top) / r.height];
	}

	ripple(x, y) {
		const r = this.root.getBoundingClientRect();
		const el = document.createElement("div");
		el.className = "tap-ripple";
		el.style.left = `${x - r.left}px`;
		el.style.top = `${y - r.top}px`;
		this.root.append(el);
		setTimeout(() => el.remove(), 450);
	}

	/* ------------------------------------------------------------ buttons */

	pressButton(id, btn) {
		const act = btn.dataset.act;
		const t = { kind: "button", btn, act, t0: performance.now() };
		this.touches.set(id, t);
		btn.classList.add("on");
		this.buzz(act === "fire" ? 12 : 8);

		switch (act) {
			case "fire": this.hold(NEED.Attack); break;
			case "jetup": this.hold(NEED.JetUp); break;
			case "jetdown": this.hold(NEED.JetDown); break;
			case "throw": this.game.pulse(NEED.PickUp); break;
			case "weapon":
				t.longTimer = setTimeout(() => {
					t.longFired = true;
					this.game.pulse(NEED.PrevWeapon);
					this.buzz();
				}, LONG_PRESS_MS);
				break;
		}
	}

	releaseButton(id, cancelled) {
		const t = this.touches.get(id);
		if (!t) return;
		this.touches.delete(id);
		t.btn.classList.remove("on");
		switch (t.act) {
			case "fire": this.release(NEED.Attack); break;
			case "jetup": this.release(NEED.JetUp); break;
			case "jetdown": this.release(NEED.JetDown); break;
			case "weapon":
				clearTimeout(t.longTimer);
				if (!t.longFired && !cancelled) this.game.pulse(NEED.NextWeapon);
				break;
			case "pause": if (!cancelled) this.game.pause(); break;
			case "gps": if (!cancelled) this.game.pulse(NEED.ToggleGPS); break;
			case "camera": if (!cancelled) this.game.pulse(NEED.CameraMode); break;
		}
	}

	/* ------------------------------------------------------------ touch events */

	reconcile(list) {
		const live = new Set();
		for (let i = 0; i < list.length; i++) live.add(list[i].identifier);
		for (const id of [...this.touches.keys()]) {
			if (id !== "mouse" && !live.has(id)) this.finish(id, null, true);
		}
	}

	onStart(e) {
		if (this.mode === "off") return;
		e.preventDefault();
		this.reconcile(e.touches);

		for (const ct of e.changedTouches) {
			const target = ct.target && ct.target.closest ? ct.target.closest(".tbtn") : null;
			if (target && !target.hidden && !target.closest("[hidden]")) {
				this.pressButton(ct.identifier, target);
				continue;
			}

			const t = {
				kind: "tap", x0: ct.clientX, y0: ct.clientY, x: ct.clientX, y: ct.clientY,
				t0: performance.now(), moved: 0,
			};

			if (this.mode === "game") {
				if (this.stickId === null) {
					t.kind = "stick";
					t.ax = ct.clientX;
					t.ay = ct.clientY;
					t.active = false;
					this.stickId = ct.identifier;
				} else {
					// Another finger while running: act immediately (jump, or pick up)
					t.kind = "extra";
					const [nx, ny] = this.norm(ct.clientX, ct.clientY);
					this.game.tap(nx, ny);
					this.ripple(ct.clientX, ct.clientY);
					this.buzz();
				}
			} else if (this.mode === "menu") {
				t.kind = "swipe";
			}
			this.touches.set(ct.identifier, t);
		}
	}

	onMove(e) {
		if (this.mode === "off") return;
		e.preventDefault();
		this.reconcile(e.touches);

		for (const ct of e.changedTouches) {
			const t = this.touches.get(ct.identifier);
			if (!t || t.kind === "button" || t.kind === "extra") continue;
			t.x = ct.clientX;
			t.y = ct.clientY;
			t.moved = Math.max(t.moved, Math.hypot(t.x - t.x0, t.y - t.y0));

			if (t.kind === "stick") this.updateStick(t);
			else if (t.kind === "swipe" && !t.swiped) {
				const dx = t.x - t.x0, dy = t.y - t.y0;
				if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.2) {
					t.swiped = true;
					this.game.swipe(dx < 0 ? 1 : -1);
					this.buzz();
				}
			}
		}
	}

	onEnd(e, cancelled) {
		if (this.mode === "off") return;
		e.preventDefault();
		for (const ct of e.changedTouches) this.finish(ct.identifier, ct, cancelled);
		this.reconcile(e.touches);
	}

	finish(id, ct, cancelled) {
		const t = this.touches.get(id);
		if (!t) return;
		if (t.kind === "button") {
			this.releaseButton(id, cancelled);
			return;
		}
		this.touches.delete(id);

		const quick = performance.now() - t.t0 < TAP_MAX_MS && t.moved < TAP_MAX_MOVE;

		if (t.kind === "stick") {
			this.stickId = null;
			this.stickEl.hidden = true;
			this.game.stick(0, 0, false);
			if (!cancelled && quick && !t.active) this.tapAt(t.x, t.y);
		} else if (t.kind === "tap" || t.kind === "swipe") {
			if (!cancelled && quick && !t.swiped) this.tapAt(t.x, t.y);
		}
	}

	tapAt(x, y) {
		const [nx, ny] = this.norm(x, y);
		this.game.tap(nx, ny);
		if (this.mode === "game") {
			this.ripple(x, y);
			this.buzz();
		}
	}

	/* ------------------------------------------------------------ stick */

	stickRadius() {
		const ui = { s: 0.85, m: 1, l: 1.18 }[this.shell.prefs.ctlSize] || 1;
		return 58 * ui;
	}

	updateStick(t) {
		const R = this.stickRadius();
		let dx = t.x - t.ax, dy = t.y - t.ay;
		let d = Math.hypot(dx, dy);

		if (!t.active) {
			if (d < STICK_ACTIVATE) return;
			t.active = true;
			this.stickEl.hidden = false;
			this.hideMoveHint();
		}

		// The base trails the finger once it passes the rim, so a change of direction
		// registers straight away instead of after travelling back across the circle.
		if (d > R) {
			const k = (d - R) / d;
			t.ax += dx * k;
			t.ay += dy * k;
			dx = t.x - t.ax;
			dy = t.y - t.ay;
			d = R;
		}

		const mag = Math.min(1, d / R);
		const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;

		const r = this.root.getBoundingClientRect();
		const bx = t.ax - r.left, by = t.ay - r.top;
		const s = this.stickEl.style;
		s.setProperty("--bx", `${bx}px`);
		s.setProperty("--by", `${by}px`);
		s.setProperty("--kx", `${bx + ux * d}px`);
		s.setProperty("--ky", `${by + uy * d}px`);
		s.setProperty("--ang", `${Math.atan2(ux, -uy)}rad`);
		s.setProperty("--mag", mag > 0.2 ? "1" : "0");

		this.game.stick(ux * mag, uy * mag, true);
	}
}
