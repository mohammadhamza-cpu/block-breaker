# One More Line - Offline Tetris

A browser-based falling-block game with an original upbeat soundtrack and musical gameplay feedback. Built with HTML, CSS, and vanilla JavaScript. No installation, build step, accounts, external assets, or game server required.

**Play:** https://mohammadhamza-cpu.github.io/block-breaker/

## Features

- Seven-bag piece generation, SRS rotation, ghost landing preview, and three upcoming pieces.
- Keyboard and touch controls, scoring, levels, pause/resume, and local high scores.
- Original 144 BPM **Neon Sprint** music, generated locally through Web Audio.
- Ascending chimes for completed line clears, punchy hard-drop impacts, quiet soft-drop ticks, and a game-over melody.
- The header music button mutes all audio. Music starts after a user gesture; pausing or switching tabs stops playback.
- Responsive layout and reduced-motion support.

## Play locally

Download the repository and open [index.html](index.html) in a modern browser. Keep the six runtime files together. The game works directly over `file://`, without an internet connection or local server.

## Controls

- Left / Right: move; hold to repeat.
- Down: soft drop.
- Up or X: rotate clockwise.
- Z: rotate counterclockwise.
- Space: hard drop.
- P or Escape: pause / resume.
- R: restart.
- Enter: start, resume, or play again.
- Header music button: mute / unmute music and effects.

Touch controls appear on narrow screens and touch devices. High scores and audio preferences are saved only in your browser when local storage is available.

## Project files

- [index.html](index.html): game page and accessible controls.
- [styles.css](styles.css): responsive styling.
- [engine.js](engine.js): pure game rules and scoring.
- [renderer.js](renderer.js): canvas rendering.
- [music.js](music.js): original soundtrack and gameplay sound synthesis.
- [app.js](app.js): input, audio/event integration, timing, and persistence.

## Hosting: GitHub Pages only

This public repository deploys from **main**, **/ (root)** using GitHub Pages. The `.nojekyll` marker serves the files as a static site. Updates to the publishing branch trigger a new Pages build. No third-party hosting account, package installation, custom workflow, or deployment secret in the repository is needed.

Do not commit access tokens, environment files, or other credentials.

## Tests

- [tests/index.html](tests/index.html): open in a browser to run 41 deterministic engine tests.
- [tests/browser_test.py](tests/browser_test.py): Python-standard-library Chromium integration suite. Run `python3 tests/browser_test.py`; use `--browser /path/to/chrome` if needed.
- Latest local run before publication: **41 engine tests and 86 browser checks passed**, including gameplay, responsive controls, all seven sound buffers, mute/pause/restart handling, and zero HTTP/HTTPS requests from the local game.
- Audio tests checked generated signal and playback state, not subjective listening quality. Safari/Firefox UI and physical touch hardware were not tested.

Screenshots and test logs are generated under `tests/artifacts/` and are not included in the repository.
