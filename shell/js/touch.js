// Touch controls.
//
// Movement: put a finger down anywhere that isn't a button and push. A floating stick
// appears under the finger; Nano runs in the pushed direction for as long as it's held.
// If the finger keeps travelling past the rim, the stick's base follows it, so swinging
// the finger round to a new direction turns Nano without having to lift and re-place it.
//
// A quick tap (anywhere off the buttons) picks up / throws when something is in reach.
// A second finger dragged sideways swivels the camera; dragged up or down, it zooms.

import { NEED, HUD_FLAG } from "./constants.js";

const TAP_MAX_MS = 280;
const TAP_MAX_MOVE = 12;
const STICK_ACTIVATE = 7;
const STICK_FOLLOW = 1.3;		// base follows once the finger is this many radii away
const CAM_THRESHOLD = 18;
const SWIPE_MIN = 42;

export class TouchControls {
	constructor(root, game, shell, env) {
		this.root = root;
		this.game = game;
		this.shell = shell;
		this.env = env;
		this.mode = "off";
		this.pointers = new Map();
		this.stickId = null;
		this.held = new Set();

		this.stickEl = root.querySelector("#stick");
		this.knob = this.stickEl.querySelector(".stick-knob");
		this.base = this.stickEl.querySelector(".stick-base");
		this.moveHint = root.querySelector("#moveHint");
		this.weaponBtn = root.querySelector('[data-act="weapon"]');
		this.weaponIcon = root.querySelector("#weaponIcon");
		this.weaponAmmo = root.querySelector("#weaponAmmo");
		this.jet = root.querySelector("#jet");
		this.jetFuel = root.querySelector("#jetFuel");

		root.addEventListener("pointerdown", (e) => this.onDown(e));
		root.addEventListener("pointermove", (e) => this.onMove(e));
		root.addEventListener("pointerup", (e) => this.onUp(e, false));
		root.addEventListener("pointercancel", (e) => this.onUp(e, true));
		root.addEventListener("lostpointercapture", (e) => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });

		for (const btn of root.querySelectorAll(".tbtn")) this.wireButton(btn);

		document.addEventListener("visibilitychange", () => { if (document.hidden) this.releaseAll(); });
		addEventListener("blur", () => this.releaseAll());
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
		const icon = `hud/weapon-${s.weapon}.png`;
		if (this.weaponIcon.dataset.w !== String(s.weapon)) {
			this.weaponIcon.dataset.w = String(s.weapon);
			this.weaponIcon.src = icon;
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
	}

	/* ------------------------------------------------------------ helpers */

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
		this.pointers.clear();
		this.stickId = null;
		this.stickEl.hidden = true;
		this.game.stick(0, 0, false);
		for (const b of this.root.querySelectorAll(".tbtn.on")) b.classList.remove("on");
	}

	buzz() {
		if (this.shell.prefs.haptics && navigator.vibrate) {
			try { navigator.vibrate(8); } catch (e) {}
		}
	}

	norm(e) {
		const r = this.root.getBoundingClientRect();
		return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
	}

	/* ------------------------------------------------------------ buttons */

	wireButton(btn) {
		const act = btn.dataset.act;
		const holdNeed = { fire: NEED.Attack, jump: NEED.Jump, jetup: NEED.JetUp, jetdown: NEED.JetDown }[act];

		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			try { btn.setPointerCapture(e.pointerId); } catch (err) {}
			btn.classList.add("on");
			this.buzz();
			if (holdNeed !== undefined) {
				this.hold(holdNeed);
			} else if (act === "weapon") {
				btn._t = performance.now();
				clearTimeout(btn._long);
				btn._long = setTimeout(() => {
					btn._longFired = true;
					this.game.pulse(NEED.PrevWeapon);
					this.buzz();
				}, 450);
				btn._longFired = false;
			}
		});

		const up = (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!btn.classList.contains("on")) return;
			btn.classList.remove("on");
			if (holdNeed !== undefined) {
				this.release(holdNeed);
				return;
			}
			switch (act) {
				case "weapon":
					clearTimeout(btn._long);
					if (!btn._longFired && e.type === "pointerup") this.game.pulse(NEED.NextWeapon);
					break;
				case "pause":	if (e.type === "pointerup") this.game.pause(); break;
				case "gps":		if (e.type === "pointerup") this.game.pulse(NEED.ToggleGPS); break;
				case "camera":	if (e.type === "pointerup") this.game.pulse(NEED.CameraMode); break;
			}
		};
		btn.addEventListener("pointerup", up);
		btn.addEventListener("pointercancel", up);
		btn.addEventListener("contextmenu", (e) => e.preventDefault());
	}

	/* ------------------------------------------------------------ free-area gestures */

	onDown(e) {
		if (this.mode === "off" || e.pointerType === "mouse") return;
		if (e.target.closest(".tbtn")) return;
		e.preventDefault();
		try { this.root.setPointerCapture(e.pointerId); } catch (err) {}

		const p = {
			id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
			t0: performance.now(), moved: 0, role: "tap",
		};

		if (this.mode === "game") {
			if (this.stickId === null) {
				p.role = "stick";
				p.ax = e.clientX;
				p.ay = e.clientY;
				p.active = false;
				this.stickId = e.pointerId;
			} else {
				p.role = "cam";
			}
		} else if (this.mode === "menu") {
			p.role = "swipe";
		}
		this.pointers.set(e.pointerId, p);
	}

	onMove(e) {
		const p = this.pointers.get(e.pointerId);
		if (!p) return;
		e.preventDefault();
		p.x = e.clientX;
		p.y = e.clientY;
		p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));

		if (p.role === "stick") this.updateStick(p);
		else if (p.role === "cam") this.updateCamera(p);
		else if (p.role === "swipe" && !p.swiped) {
			const dx = p.x - p.x0, dy = p.y - p.y0;
			if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.2) {
				p.swiped = true;
				this.game.swipe(dx < 0 ? 1 : -1);
				this.buzz();
			}
		}
	}

	onUp(e, cancelled) {
		const p = this.pointers.get(e.pointerId);
		if (!p) return;
		this.pointers.delete(e.pointerId);

		const quick = performance.now() - p.t0 < TAP_MAX_MS && p.moved < TAP_MAX_MOVE;

		if (p.role === "stick") {
			this.stickId = null;
			this.stickEl.hidden = true;
			this.game.stick(0, 0, false);
		} else if (p.role === "cam") {
			this.release(NEED.CameraLeft);
			this.release(NEED.CameraRight);
			this.release(NEED.ZoomIn);
			this.release(NEED.ZoomOut);
		}

		if (!cancelled && quick && !p.swiped && (p.role !== "stick" || !p.active)) {
			const [nx, ny] = this.norm(e);
			this.game.tap(nx, ny);
		}
	}

	updateStick(p) {
		const R = this.stickRadius();
		let dx = p.x - p.ax, dy = p.y - p.ay;
		let d = Math.hypot(dx, dy);

		if (!p.active) {
			if (d < STICK_ACTIVATE) return;
			p.active = true;
			this.stickEl.hidden = false;
			this.hideMoveHint();
		}

		// Let the base trail the finger so direction changes register without lifting
		const maxD = R * STICK_FOLLOW;
		if (d > maxD) {
			const k = (d - maxD) / d;
			p.ax += dx * k;
			p.ay += dy * k;
			dx = p.x - p.ax;
			dy = p.y - p.ay;
			d = maxD;
		}

		const mag = Math.min(1, d / R);
		const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
		const kx = ux * Math.min(d, R), ky = uy * Math.min(d, R);

		const r = this.root.getBoundingClientRect();
		const bx = p.ax - r.left, by = p.ay - r.top;
		this.stickEl.style.setProperty("--bx", `${bx}px`);
		this.stickEl.style.setProperty("--by", `${by}px`);
		this.stickEl.style.setProperty("--kx", `${bx + kx}px`);
		this.stickEl.style.setProperty("--ky", `${by + ky}px`);
		this.stickEl.style.setProperty("--ang", `${Math.atan2(ux, -uy)}rad`);
		this.stickEl.style.setProperty("--mag", mag > 0.2 ? "1" : "0");

		this.game.stick(ux * mag, uy * mag, true);
	}

	stickRadius() {
		const ui = { s: 0.85, m: 1, l: 1.18 }[this.shell.prefs.ctlSize] || 1;
		return 62 * ui;
	}

	updateCamera(p) {
		const dx = p.x - p.x0, dy = p.y - p.y0;
		const horizontal = Math.abs(dx) >= Math.abs(dy);
		if (horizontal && Math.abs(dx) > CAM_THRESHOLD) {
			this.release(NEED.ZoomIn); this.release(NEED.ZoomOut);
			if (dx > 0) { this.release(NEED.CameraLeft); this.hold(NEED.CameraRight); }
			else { this.release(NEED.CameraRight); this.hold(NEED.CameraLeft); }
		} else if (!horizontal && Math.abs(dy) > CAM_THRESHOLD) {
			this.release(NEED.CameraLeft); this.release(NEED.CameraRight);
			if (dy < 0) { this.release(NEED.ZoomOut); this.hold(NEED.ZoomIn); }
			else { this.release(NEED.ZoomIn); this.hold(NEED.ZoomOut); }
		} else {
			this.release(NEED.CameraLeft); this.release(NEED.CameraRight);
			this.release(NEED.ZoomIn); this.release(NEED.ZoomOut);
		}
	}
}
