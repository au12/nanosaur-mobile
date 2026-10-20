# Nanosaur Mobile

Pangea Software's **Nanosaur** (1998), playable in any modern browser — phone, tablet or desktop — from a single Docker container.

This builds [Iliyas Jorio's modern Nanosaur source](https://github.com/jorio/Nanosaur) to WebAssembly with a small set of web-port patches, and wraps it in a mobile-first shell:

- **Touch controls** — a floating stick that appears wherever you put your thumb: Nano runs the way you push, turns smoothly when you swing your finger round without lifting it, walks or runs depending on how far you push, and stops the moment you let go. **Tap anywhere to jump** (a second finger while running; taps in mid-air are buffered into the double jump). A tap next to an egg picks it up, and a **Throw** button appears while you carry one. A big red **Fire** button, a weapon button, and jetpack thrust buttons that appear when you have fuel.
- **Touch-friendly menus** — swipe the 3D main-menu wheel or tap any icon; tap the front icon to choose. The settings screen becomes a proper touch sheet, the pause menu gets big buttons (the 3D *Resume* / *Quit* words are tappable too), and high-score names use your phone's keyboard.
- **Compact HUD** — the original 1998 infobar, cut into floating plaques with the original sprites, so the 3D view fills the screen: lives and health top-left, eggs top-right (with a count for extra eggs of a species and a flash for every egg beamed up), time to impact and score bottom-left. The classic full frame is one setting away (and switches live, mid-level).
- **Landscape lock** — an animated "turn your phone sideways" prompt in portrait; gameplay auto-pauses until you rotate.
- **Fullscreen + device aspect ratio** — the view fills whatever screen it's on (or keeps the original 4:3, your choice); fullscreen button, Alt+Enter, and orientation lock on Android.
- **PWA with offline play** — install it to the home screen and it always plays offline. Settings, key bindings and high scores are saved on the device.
- **Desktop** — the original key bindings (Alt jumps / Ctrl picks up; Command / Option on a Mac, as on the original Mac release), fully remappable from Settings → Keyboard, plus a one-click "browser-friendly" preset. Mouse and game controllers work too.
- **Extras** — render-resolution and 30 fps battery-saver options for older phones, an FPS counter, HUD size, left-handed button layout, button size/opacity, vibration feedback, screen wake lock, auto-pause when the app goes to the background, and an update prompt when a new build is deployed.

## Run it

```sh
docker compose up -d --build
```

Then open `http://<server>:8086`. The first build takes a few minutes (it compiles SDL3 and the game with Emscripten); the finished image is about 45 MB (nginx plus the static game files).

### HTTPS is required for install and offline play

Browsers only allow service workers — and therefore "Add to Home Screen" with offline play — on HTTPS (or `localhost`). Put it behind Nginx Proxy Manager like your other apps:

1. **Hosts → Proxy Hosts → Add**: domain `nanosaur.<your domain>`, scheme `http`, forward to `<unraid ip>` port `8086`.
2. **SSL**: request a Let's Encrypt certificate, enable *Force SSL* and *HTTP/2*.

No websockets or special headers are needed; the container sets the right MIME types and compression.

### Unraid

Either build on the server:

```sh
cd /mnt/user/appdata && git clone https://github.com/au12/nanosaur-mobile && cd nanosaur-mobile
docker build -t nanosaur-mobile .
```

…and add a container using image `nanosaur-mobile` with port `8086 → 80`. Or use the prebuilt image: the included workflow (`.github/workflows/docker.yml`) builds `ghcr.io/au12/nanosaur-mobile:latest` for amd64 and arm64 on every push to `main`, and `unraid/nanosaur-mobile.xml` is a ready-made template for it (copy it to `/boot/config/plugins/dockerMan/templates-user/`). GitHub makes new container packages private; set the package to public in its settings, or `docker login ghcr.io` on Unraid, so the server can pull it.

## Controls

| | Touch | Keyboard (PC) | Keyboard (Mac) |
|---|---|---|---|
| Move | Drag anywhere | Arrow keys | Arrow keys |
| Jump / double-jump | Tap anywhere (second finger while running) | Alt | Command |
| Fire | Round button (hold) | Space, left click | Space, left click |
| Pick up / throw | Tap next to an egg / Throw button | Ctrl, middle click | Option, middle click |
| Change weapon | Tap weapon button (hold for previous) | Shift, `[` `]`, mouse wheel | same |
| Jetpack up / down | ▲ / ▼ buttons (when you have fuel) | A / Z | A / Z |
| Camera swivel / zoom | — | `,` `.` / `1` `2` | same |
| Camera mode | Eye button | Tab | Tab |
| Map | Map button | G | G |
| Pause | Pause button | Esc | Esc |

Everything on the keyboard can be remapped in **Settings → Keyboard** (or the game's own *Configure Controls* page).

## How it works

```
Dockerfile
  stage 1  emscripten/emsdk:4.0.10
           ├─ clone jorio/Nanosaur @ NANOSAUR_COMMIT (+ Pomme submodule) and SDL release-3.4.4
           ├─ apply patches/nanosaur-web.patch and patches/pomme-web.patch
           ├─ emcmake + build  →  nanosaur.js / .wasm / .data
           └─ shell/ + HUD art cut from the game's own data (tools/*.py) + versioned service worker
  stage 2  nginx:alpine serving the bundle
```

- **Rendering.** Nanosaur draws with legacy fixed-function OpenGL (matrix stacks, client-side arrays, per-vertex lighting, fog, alpha test, Mac pixel formats). `src/Web/WebGL_FFP.c` (in the patch) implements exactly that subset on WebGL 2 with a handful of cached shaders and ring-buffered vertex streams.
- **Main loop.** The game's many blocking loops run unchanged under Emscripten's Asyncify; every frame yields to `requestAnimationFrame`, so it's vsynced, pauses in background tabs, and honours the 30 fps option.
- **Bridge.** `src/Web/WebBridge.c` reports the current screen and HUD state to the page and accepts virtual input (touch stick, buttons, taps, swipes, name entry, settings). The shell in `shell/` turns that into the touch UI, HUD plaques and settings sheet.
- **Storage.** Prefs and high scores live in IndexedDB (Emscripten IDBFS); the game files are precached by `shell/sw.js`.

### Building without Docker

With [emsdk](https://emscripten.org/docs/getting_started/downloads.html) 4.0.10 activated, CMake ≥ 3.21 and Python 3:

```sh
git clone https://github.com/jorio/Nanosaur && cd Nanosaur
git checkout 29c451b8cedd2febaf0d0d6b09b678e08d42c926 && git submodule update --init --recursive
git clone --depth 1 --branch release-3.4.4 https://github.com/libsdl-org/SDL extern/SDL
/path/to/nanosaur-mobile/scripts/build-web.sh . /path/to/output
```

Serve the output folder with any static web server.

### Updating to a newer upstream Nanosaur

Bump `NANOSAUR_COMMIT` in the Dockerfile. If the patch no longer applies, check out the new commit, apply `patches/nanosaur-web.patch` with `git apply --3way`, resolve, and regenerate it with `git diff <commit> -- . ':(exclude)extern' > patches/nanosaur-web.patch`.

## License

Nanosaur is © 1998 Pangea Software, Inc.; the modern source and game data are licensed **CC BY-NC-SA 4.0** by Pangea Software and Iliyas Jorio. The patches and web shell in this repo are offered under the same terms. Keep it non-commercial. Fonts: Lilita One and Nunito (SIL Open Font License, included).
