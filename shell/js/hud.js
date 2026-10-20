// Compact HUD: the original 1998 infobar cut into floating plaques.
// Sprites are placed with the game's own pixel coordinates (relative to each plaque),
// so every digit and icon lands exactly where Pangea drew it.

import { HUD_FLAG } from "./constants.js";

export class Hud {
	constructor(root) {
		this.root = root;
		this.visible = false;
		this.compact = true;
		this.state = null;
		this.listeners = [];
		this.el = {};
		this.ready = fetch("hud/hud.json").then((r) => r.json()).then((meta) => this.build(meta)).catch(() => {});
		this.hint = root.querySelector("#pickupHint");
		this.carryHintUntil = 0;
		this.wasCarrying = false;
		this.keyLabelFor = null;		// set by touch/settings: returns the pick-up key name
		this.touchMode = false;
	}

	onUpdate(fn) { this.listeners.push(fn); }

	build(meta) {
		this.meta = meta;
		for (const plaque of this.root.querySelectorAll(".plaque")) {
			const name = plaque.dataset.plaque;
			const p = meta.plaques[name];
			const slots = meta.slots[name];
			plaque.style.setProperty("--pw", p.w);
			plaque.style.setProperty("--ph", p.h);
			plaque.style.backgroundImage = `url("hud/plaque-${name}.png")`;
			const refs = {};
			const addSprite = (cls, x, y, w, h, src) => {
				const el = src ? document.createElement("img") : document.createElement("div");
				if (src) { el.src = src; el.alt = ""; }
				el.className = cls;
				el.style.setProperty("--sx", x);
				el.style.setProperty("--sy", y);
				el.style.setProperty("--sw", w);
				el.style.setProperty("--sh", h);
				plaque.append(el);
				return el;
			};
			switch (name) {
				case "time":
					refs.sec = slots.seconds.map(([x, y]) => addSprite("digit", x, y, 16, 16, "hud/digit-0.png"));
					refs.min = slots.minutes.map(([x, y]) => addSprite("digit", x, y, 16, 16, "hud/digit-0.png"));
					break;
				case "score":
					refs.digits = slots.digits.map(([x, y]) => addSprite("digit", x, y, 16, 16, "hud/digit-0.png"));
					break;
				case "lives":
					refs.digits = slots.digits.map(([x, y]) => addSprite("digit", x, y, 16, 16, "hud/digit-2.png"));
					break;
				case "health": {
					const [x, y, w, h] = slots.meter[0];
					const m = addSprite("meter-fill", x, y, w, h);
					m.append(document.createElement("i"));
					refs.meter = m;
					break;
				}
				case "eggs":
					refs.eggs = slots.eggs.map(([x, y], i) => addSprite("egg-sprite", x, y, 26, 41, `hud/egg-${i}.png`));
					refs.counts = slots.eggs.map(([x, y]) => {
						const c = document.createElement("span");
						c.className = "egg-count";
						c.style.setProperty("--sx", x + 15);
						c.style.setProperty("--sy", y + 27);
						c.hidden = true;
						plaque.append(c);
						return c;
					});
					break;
				case "weapon":
					refs.icon = addSprite("weapon-icon", slots.icon[0][0], slots.icon[0][1], 64, 64, "hud/weapon-0.png");
					refs.digits = slots.ammo.map(([x, y]) => addSprite("digit", x, y, 16, 16, "hud/digit-0.png"));
					break;
				case "fuel":
					refs.gauge = addSprite("sprite fuel-sprite", slots.gauge[0][0], slots.gauge[0][1], 28, 107);
					break;
			}
			this.el[name] = { plaque, ...refs };
		}
		if (this.state) this.render(this.state, true);
	}

	setVisible(on) {
		this.visible = on;
		this.applyVisibility();
	}

	setTouchLayout(on) {
		this.touchMode = on;
		this.root.classList.toggle("touch-layout", on);
	}

	applyVisibility() {
		this.root.hidden = !(this.visible && this.compact);
		if (this.root.hidden) this.hint.hidden = true;
	}

	update(v) {
		const [time, score, health, lives, weapon, ammo, fuelFrame, eggs, flags, weaponMask] = v;
		const s = { time, score, health, lives, weapon, ammo, fuelFrame, eggs, flags, weaponMask };
		const prev = this.state;
		this.state = s;
		this.compact = !(flags & HUD_FLAG.Classic);
		this.applyVisibility();
		if (this.meta) this.render(s, !prev, prev);
		for (const fn of this.listeners) fn(s, prev);
	}

	setDigits(imgs, value, count) {
		let n = Math.max(0, Math.floor(value));
		for (let i = 0; i < count && i < imgs.length; i++) {
			const d = n % 10;
			n = Math.floor(n / 10);
			const src = `hud/digit-${d}.png`;
			if (imgs[i].dataset.d !== String(d)) {
				imgs[i].dataset.d = String(d);
				imgs[i].src = src;
			}
		}
	}

	render(s, force, prev) {
		const e = this.el;
		if (!e.time) return;
		const t = Math.max(0, s.time);
		this.setDigits(e.time.sec, t % 60, 2);
		this.setDigits(e.time.min, Math.floor(t / 60), 2);
		e.time.plaque.classList.toggle("urgent", !!(s.flags & HUD_FLAG.Urgent) && t > 0);

		this.setDigits(e.score.digits, s.score, 8);
		if (prev && s.score > prev.score) this.bump(e.score.plaque);

		this.setDigits(e.lives.digits, s.lives, 1);
		if (prev && s.lives !== prev.lives) this.bump(e.lives.plaque);

		e.health.meter.style.setProperty("--fill", `${(s.health / 10).toFixed(1)}%`);

		// 4 bits per species: how many eggs of that species have been beamed up
		e.eggs.eggs.forEach((img, i) => {
			const n = (s.eggs >> (4 * i)) & 15;
			const before = prev ? (prev.eggs >> (4 * i)) & 15 : n;
			img.classList.toggle("on", n > 0);
			const badge = e.eggs.counts[i];
			badge.hidden = n < 2;
			badge.textContent = String(n);
			if (n > before) {
				img.classList.remove("flash");
				void img.offsetWidth;
				img.classList.add("flash");
				this.bump(e.eggs.plaque);
			}
		});

		const icon = `hud/weapon-${s.weapon}.png`;
		if (e.weapon.icon.dataset.w !== String(s.weapon)) {
			e.weapon.icon.dataset.w = String(s.weapon);
			e.weapon.icon.src = icon;
		}
		this.setDigits(e.weapon.digits, s.ammo, 3);

		const frames = (this.meta.fuel && this.meta.fuel.frames) || 29;
		const idx = Math.max(0, Math.min(frames - 1, s.fuelFrame - ((this.meta.fuel && this.meta.fuel.firstFrame) || 16)));
		e.fuel.gauge.style.backgroundPosition = `0 ${(idx / (frames - 1)) * 100}%`;

		this.renderHint(s);
	}

	renderHint(s) {
		const carrying = !!(s.flags & HUD_FLAG.Carrying);
		const near = !!(s.flags & HUD_FLAG.PickupNear);
		const now = performance.now();
		if (carrying && !this.wasCarrying) this.carryHintUntil = now + 3200;
		this.wasCarrying = carrying;

		let text = "";
		if (!(s.flags & (HUD_FLAG.Dead | HUD_FLAG.Paused))) {
			const key = this.touchMode ? null : (this.keyLabelFor ? this.keyLabelFor() : null);
			if (carrying && now < this.carryHintUntil) {
				text = "Carry it into a time portal";
			} else if (near && !carrying) {
				text = this.touchMode ? "Tap to pick up" : key ? `${key} to pick up` : "";
			}
		}
		if (text !== this.hint.textContent) this.hint.textContent = text;
		this.hint.hidden = !text || this.root.hidden;
		if (carrying && now < this.carryHintUntil) {
			clearTimeout(this.hintTimer);
			this.hintTimer = setTimeout(() => this.state && this.renderHint(this.state), this.carryHintUntil - now + 20);
		}
	}

	bump(el) {
		el.classList.remove("bump");
		void el.offsetWidth;
		el.classList.add("bump");
	}
}
