// Shared constants mirroring the game's C enums (input.h, Web.h, WebBridge.c).

export const NEED = {
	Forward: 0, Backward: 1, TurnLeft: 2, TurnRight: 3, Jump: 4, Attack: 5,
	PrevWeapon: 6, NextWeapon: 7, PickUp: 8, JetUp: 9, JetDown: 10,
	CameraLeft: 11, CameraRight: 12, ZoomIn: 13, ZoomOut: 14, CameraMode: 15,
	ToggleGPS: 16, ToggleMusic: 17, ToggleAmbient: 18,
	UIUp: 19, UIDown: 20, UILeft: 21, UIRight: 22, UIConfirm: 23, UIBack: 24, UIPause: 25,
};

export const NEED_LABELS = [
	"Go forward", "Go backwards", "Turn left", "Turn right", "Jump, double-jump", "Shoot",
	"Previous weapon", "Next weapon", "Pick up, throw", "Jetpack up", "Jetpack down",
	"Swivel camera left", "Swivel camera right", "Zoom in", "Zoom out", "Camera mode",
	"Toggle map", "Toggle music", "Toggle ambient sounds",
];

// Display order for the remapping table (matches the in-game Configure Controls page)
export const NEED_ORDER = [0, 1, 2, 3, 9, 10, 6, 7, 5, 8, 4, 15, 11, 12, 13, 14, 16, 17, 18];

export const SCREEN = {
	Boot: 0, Logo: 1, Charity: 2, Title: 3, MainMenu: 4, Settings: 5, Help: 6,
	HighScores: 7, NameEntry: 8, Game: 9, Paused: 10, Movie: 11, Exited: 12, Controls: 13,
};

export const PREF = {
	Extreme: 0, Music: 1, Ambient: 2, Force4x3: 3, HQTextures: 4, Fog: 5, WhiteSky: 6,
	TeethFix: 7, MenuHelp: 8, HUDStyle: 9, Antialiasing: 10, Shadows: 11,
};

export const MENU_ITEMS = ["Play", "Settings", "Help", "Exit", "High scores"];

export const HUD_FLAG = {
	Carrying: 1 << 0, PickupNear: 1 << 1, Jetting: 1 << 2, OnGround: 1 << 3,
	HasFuel: 1 << 4, Dead: 1 << 5, Urgent: 1 << 6, Classic: 1 << 7, Paused: 1 << 8,
};

// KeyboardEvent.code -> SDL_Scancode (USB HID usage IDs)
export const CODE_TO_SCANCODE = (() => {
	const m = {};
	for (let i = 0; i < 26; i++) m["Key" + String.fromCharCode(65 + i)] = 4 + i;
	for (let i = 1; i <= 9; i++) m["Digit" + i] = 29 + i;
	m.Digit0 = 39;
	Object.assign(m, {
		Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46,
		BracketLeft: 47, BracketRight: 48, Backslash: 49, Semicolon: 51, Quote: 52,
		Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
		PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75,
		Delete: 76, End: 77, PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81,
		ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86,
		NumpadAdd: 87, NumpadEnter: 88, NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101,
		NumpadEqual: 103,
		ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
		ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
		OSLeft: 227, OSRight: 231,
	});
	for (let i = 1; i <= 12; i++) m["F" + i] = 57 + i;
	for (let i = 13; i <= 24; i++) m["F" + i] = 104 + (i - 13);
	for (let i = 1; i <= 9; i++) m["Numpad" + i] = 88 + i;
	m.Numpad0 = 98;
	return m;
})();

export const SC = { A: 4, C: 6, X: 27, Z: 29, Space: 44, LAlt: 226, RAlt: 230, LCtrl: 224, RCtrl: 228, LGui: 227, RGui: 231 };

// Friendlier names than SDL's for the remap UI on Macs
export function prettyKeyName(sdlName, scancode, isMac) {
	if (!scancode) return "";
	if (isMac) {
		if (scancode === SC.LGui || scancode === SC.RGui) return (scancode === SC.LGui ? "Left" : "Right") + " Command";
		if (scancode === SC.LAlt || scancode === SC.RAlt) return (scancode === SC.LAlt ? "Left" : "Right") + " Option";
	} else if (scancode === SC.LGui || scancode === SC.RGui) {
		return (scancode === SC.LGui ? "Left" : "Right") + " Windows";
	}
	return sdlName || ("Key " + scancode);
}
