"""Dependency-free Chromium integration tests via the DevTools protocol.

Run: python3 tetris/tests/browser_test.py [--browser /path/to/chrome]
Uses a temporary browser profile, file:// URLs, and no internet/server/packages.
Only the browser started by this script is terminated. Artifacts are written below tests/.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"


class DevTools:
    """Small synchronous RFC6455 client; sufficient for local Chrome CDP."""
    def __init__(self, url):
        from urllib.parse import urlparse
        endpoint = urlparse(url)
        self.socket = socket.create_connection((endpoint.hostname, endpoint.port), timeout=10)
        self.buffer = b""
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f"GET {endpoint.path} HTTP/1.1\r\nHost: {endpoint.netloc}\r\n"
                             f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
                             f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        while b"\r\n\r\n" not in self.buffer:
            self.buffer += self.socket.recv(4096)
        headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if headers.split(b"\r\n", 1)[0].split()[1] != b"101" or expected not in headers:
            raise RuntimeError(f"WebSocket handshake failed: {headers!r}")
        self.serial = 0
        self.events = []

    def read(self, count):
        while len(self.buffer) < count:
            chunk = self.socket.recv(max(4096, count - len(self.buffer)))
            if not chunk:
                raise RuntimeError("Browser disconnected")
            self.buffer += chunk
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def send(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", length)
        encoded = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(header + mask + encoded)

    def receive(self):
        fragments = b""
        while True:
            first, second = self.read(2)
            length = second & 127
            if length == 126:
                length = struct.unpack("!H", self.read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.read(8))[0]
            mask = self.read(4) if second & 128 else None
            payload = self.read(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            opcode = first & 15
            if opcode == 8:
                raise RuntimeError("WebSocket closed")
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            fragments += payload
            if first & 128:
                return json.loads(fragments)

    def call(self, method, **params):
        self.serial += 1
        request_id = self.serial
        self.send(json.dumps({"id": request_id, "method": method, "params": params}).encode())
        while True:
            response = self.receive()
            if response.get("id") == request_id:
                if "error" in response:
                    raise RuntimeError(f"{method}: {response['error']}")
                return response.get("result", {})
            self.events.append(response)

    def js(self, expression):
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"]))
        return result.get("result", {}).get("value")

    def wait(self, expression, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.js(expression):
                return
            time.sleep(.03)
        raise AssertionError(f"Timed out waiting for {expression}")

    def navigate(self, path):
        self.call("Page.navigate", url=path.as_uri())
        self.wait("document.readyState === 'complete'")
        self.wait("Boolean(window.TetrisApp || window.TetrisTestResults)")

    def key(self, code, key=None, hold=0, repeat=False):
        values = {"ArrowLeft": 37, "ArrowRight": 39, "ArrowDown": 40, "ArrowUp": 38,
                  "Space": 32, "Escape": 27, "Enter": 13}
        virtual = values.get(code, ord(code[-1]) if code.startswith("Key") else 0)
        params = dict(code=code, key=key or (code[-1].lower() if code.startswith("Key") else " " if code == "Space" else code),
                      windowsVirtualKeyCode=virtual, nativeVirtualKeyCode=virtual)
        character = " " if code == "Space" else "\r" if code == "Enter" else ""
        self.call("Input.dispatchKeyEvent", type="keyDown", autoRepeat=repeat, text=character, unmodifiedText=character, **params)
        if hold:
            time.sleep(hold)
        self.call("Input.dispatchKeyEvent", type="keyUp", **params)
        time.sleep(.035)

    def click(self, selector):
        point = self.js(f"(() => {{ const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect(); return {{x:r.x+r.width/2,y:r.y+r.height/2}}; }})()")
        self.call("Input.dispatchMouseEvent", type="mousePressed", button="left", clickCount=1, **point)
        self.call("Input.dispatchMouseEvent", type="mouseReleased", button="left", clickCount=1, **point)
        time.sleep(.05)

    def screenshot(self, name):
        image = self.call("Page.captureScreenshot", format="png", captureBeyondViewport=True)
        (ARTIFACTS / name).write_bytes(base64.b64decode(image["data"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser")
    args = parser.parse_args()
    candidates = [args.browser, shutil.which("chromium"), shutil.which("google-chrome"),
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
    browser = next((path for path in candidates if path and Path(path).is_file()), None)
    if not browser:
        raise SystemExit("No Chromium browser found. Supply --browser /path/to/chrome.")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = []
    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        results.append({"name": name, "passed": True})
        print("PASS", name, flush=True)

    with tempfile.TemporaryDirectory(prefix="tetris-browser-test-") as profile:
        log = open(ARTIFACTS / "chrome.log", "w")
        process = subprocess.Popen([browser, "--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio",
                                    "--disable-background-networking", "--disable-sync", "--disable-component-update",
                                    "--disable-features=MediaRouter", "--remote-debugging-port=0",
                                    f"--user-data-dir={profile}", "about:blank"], stdout=log, stderr=log)
        client = None
        try:
            port_file = Path(profile) / "DevToolsActivePort"
            deadline = time.monotonic() + 25
            while not port_file.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("Chrome did not start; inspect tests/artifacts/chrome.log")
                time.sleep(.1)
            port = int(port_file.read_text().splitlines()[0])
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
                pages = json.load(response)
            client = DevTools(next(page["webSocketDebuggerUrl"] for page in pages if page["type"] == "page"))
            c = client
            c.call("Page.enable")
            c.call("Runtime.enable")
            c.call("Log.enable")
            c.call("Network.enable")
            c.call("Emulation.setDeviceMetricsOverride", width=1100, height=850, deviceScaleFactor=1, mobile=False)
            c.navigate(ROOT / "tests" / "index.html")
            engine_results = c.js("TetrisTestResults")
            check(f"Chromium engine regression suite ({len(engine_results)} tests)", all(item["passed"] for item in engine_results))
            c.navigate(ROOT / "index.html")
            c.wait("Boolean(window.TetrisApp)")
            check("Loads over file:// with ready overlay and three-piece preview", c.js("TetrisApp.game.state==='ready' && !document.getElementById('game-overlay').hidden && TetrisApp.game.queue.length===3"))
            check("Music does not create an audio context or autoplay before Start", c.js("TetrisApp.music.context===null && TetrisApp.music.source===null"))
            c.screenshot("desktop-ready.png")
            c.click("#primary-button")
            check("Start button starts game and focuses board", c.js("TetrisApp.game.state==='running' && document.activeElement.id==='board' && document.getElementById('game-overlay').hidden"))
            c.wait("TetrisApp.music.source!==null", timeout=10)
            check("Start gesture plays the new 144 BPM looping soundtrack", c.js("TetrisApp.music.context.state==='running' && TetrisApp.music.source.loop && TetrisMusic.track.bpm===144"))
            audio_stats = c.js("(() => {const b=TetrisApp.music.buffer;let peak=0,sum=0,finite=true,seam=0;for(let c=0;c<b.numberOfChannels;c++){const s=b.getChannelData(c);for(const v of s){finite=finite&&Number.isFinite(v);peak=Math.max(peak,Math.abs(v));sum+=v*v;}seam=Math.max(seam,Math.abs(s[0]-s[s.length-1]));}return {duration:b.duration,channels:b.numberOfChannels,peak,rms:Math.sqrt(sum/(b.length*b.numberOfChannels)),finite,seam};})()")
            check("Rendered soundtrack is finite stereo audio with signal and clipping headroom", audio_stats["finite"] and audio_stats["channels"]==2 and .1<audio_stats["peak"]<.71 and .01<audio_stats["rms"]<.5)
            check("16-bar loop has the expected duration and a smooth sample boundary", abs(audio_stats["duration"]-26.6666667)<.001 and audio_stats["seam"]<.05)
            c.js("window.initialMusicContext=TetrisApp.music.context;window.initialMusicBuffer=TetrisApp.music.buffer")
            # Observe successful cue playback without replacing the real audio path.
            c.js("window.cueLog=[];const originalEffect=TetrisApp.music.effect;TetrisApp.music.effect=function(kind,count){const played=originalEffect.call(this,kind,count);if(played)cueLog.push({kind,count,lines:TetrisApp.game.lines,rows:TetrisApp.game.clearingRows.length});return played;}")
            c.click("#music-button")
            check("Music button mutes and saves the preference", c.js("!TetrisApp.music.enabled && TetrisApp.music.source===null && localStorage.getItem('one-more-line.tetris.music.v1')==='off' && document.getElementById('music-button').getAttribute('aria-pressed')==='false'"))
            check("The shared audio toggle also suppresses every gameplay cue", c.js("['soft','hard','clear','over'].every(kind=>!TetrisApp.music.effect(kind)) && TetrisApp.music.effects.size===0 && document.getElementById('music-button').getAttribute('aria-label')==='Enable audio'"))
            c.click("#music-button")
            c.wait("TetrisApp.music.source!==null")
            check("Unmute reuses the rendered buffer and audio context", c.js("TetrisApp.music.context===initialMusicContext && TetrisApp.music.buffer===initialMusicBuffer"))
            c.key("KeyR")
            c.js("document.getElementById('pause-button').focus()")
            c.key("Space")
            check("Space activates a keyboard-focused pause button rather than dropping", c.js("TetrisApp.game.state==='paused' && TetrisApp.game.piecesLocked===0"))
            check("Pausing stops music without discarding the playback position", c.js("TetrisApp.music.source===null && !TetrisApp.music.wanted && TetrisApp.music.offset>=0"))
            c.key("Space")
            check("Space activates a keyboard-focused resume button", c.js("TetrisApp.game.state==='running' && document.activeElement.id==='board'"))
            c.wait("TetrisApp.music.source!==null")
            check("Resuming restores music from the existing buffer", c.js("TetrisApp.music.buffer===initialMusicBuffer"))
            c.js("TetrisApp.game.active={type:'T',rotation:0,x:3,y:5}")
            c.key("ArrowLeft")
            check("Left arrow moves one column", c.js("TetrisApp.game.active.x===2"))
            c.key("ArrowRight")
            check("Right arrow moves one column", c.js("TetrisApp.game.active.x===3"))
            c.key("ArrowUp")
            check("Up arrow rotates clockwise", c.js("TetrisApp.game.active.rotation===1"))
            c.key("KeyZ")
            check("Z rotates counterclockwise", c.js("TetrisApp.game.active.rotation===0"))
            c.key("KeyX")
            check("X rotates clockwise", c.js("TetrisApp.game.active.rotation===1"))
            c.key("ArrowDown", hold=.30)
            check("Held soft drop moves repeatedly and scores", c.js("TetrisApp.game.score>=4 && TetrisApp.game.active.y>=9"))
            check("Successful held soft drops play quiet rate-limited ticks", c.js("cueLog.filter(e=>e.kind==='soft').length>=2 && cueLog.filter(e=>e.kind==='soft').length<=6 && TetrisApp.music.effectBuffers.has('soft')"))
            c.key("ArrowRight", hold=.4)
            x = c.js("TetrisApp.game.active.x")
            check("Held horizontal input repeats to wall without collision", c.js("Math.max(...TetrisApp.game.cells().map(c=>c[0]))===9 && !TetrisApp.game.collides(TetrisApp.game.active)"))
            time.sleep(.13)
            check("Key release stops repeat", c.js("TetrisApp.game.active.x") == x)
            c.key("Space")
            check("Space hard drops and locks exactly one piece", c.js("TetrisApp.game.piecesLocked===1 && TetrisApp.game.score>4"))
            check("Hard drop plays one distinct impact buffer", c.js("cueLog.filter(e=>e.kind==='hard').length===1 && TetrisApp.music.effectBuffers.has('hard')"))
            c.key("Space", repeat=True)
            check("OS repeat does not repeat hard drop", c.js("TetrisApp.game.piecesLocked===1"))
            check("OS key repeat does not double-trigger the impact", c.js("cueLog.filter(e=>e.kind==='hard').length===1"))
            c.key("KeyP")
            snapshot = c.js("JSON.stringify({active:TetrisApp.game.active,board:TetrisApp.game.board,score:TetrisApp.game.score,clock:TetrisApp.game.gravityClock})")
            c.key("ArrowLeft"); c.key("Space"); time.sleep(.7)
            check("P pauses, shows overlay, and freezes board/input/timing", c.js("TetrisApp.game.state==='paused' && !document.getElementById('game-overlay').hidden") and snapshot == c.js("JSON.stringify({active:TetrisApp.game.active,board:TetrisApp.game.board,score:TetrisApp.game.score,clock:TetrisApp.game.gravityClock})"))
            check("Pause clears effect voices and prevents drop/clear sounds", c.js("TetrisApp.music.effects.size===0 && ['soft','hard','clear'].every(kind=>!TetrisApp.music.effect(kind))"))
            c.key("KeyP", repeat=True)
            check("OS key repeat cannot toggle pause", c.js("TetrisApp.game.state==='paused'"))
            c.key("Escape")
            check("Escape resumes without catching up paused time", c.js("TetrisApp.game.state==='running' && TetrisApp.game.gravityClock<400"))
            c.key("Escape")
            c.click("#primary-button")
            check("Overlay resume button works", c.js("TetrisApp.game.state==='running'"))
            c.js("window.dispatchEvent(new Event('blur'))")
            check("Blur event automatically pauses", c.js("TetrisApp.game.state==='paused'"))
            check("Music also stops when the game loses focus", c.js("TetrisApp.music.source===null && !TetrisApp.music.wanted"))
            c.click("#pause-button")
            check("Header pause/resume button works", c.js("TetrisApp.game.state==='running'"))

            # Deterministic board fixtures, followed by real keyboard events and live RAF simulation.
            c.key("KeyR")
            c.js("(() => {const g=TetrisApp.game; g.lines=9; for(let y=18;y<22;y++){g.board[y].fill('J');g.board[y][4]=null;}g.active={type:'I',rotation:1,x:2,y:18};})()")
            c.key("Space"); time.sleep(.25)
            check("Live four-line clear updates score, level, lines and speed", c.js("TetrisApp.game.score===800 && TetrisApp.game.lines===13 && TetrisApp.game.level===2 && TetrisApp.game.dropInterval===800 && document.getElementById('score').textContent==='800' && document.getElementById('lines').textContent==='13' && document.getElementById('level').textContent==='02'"))
            check("Clear feedback and level progress are rendered", c.js("document.getElementById('board-announcement').textContent.includes('LEVEL 2') && document.getElementById('level-progress').getAttribute('aria-valuenow')==='3'"))
            check("Four-line clear plays one richer chime after rows are removed", c.js("cueLog.filter(e=>e.kind==='clear').length===1 && cueLog.some(e=>e.kind==='clear'&&e.count===4&&e.rows===0&&e.lines===13) && TetrisApp.music.effectBuffers.has('clear-4')"))
            check("High score persists locally", c.js("localStorage.getItem('one-more-line.tetris.high-score.v1')==='800'"))
            c.key("KeyR")
            c.js("TetrisApp.game.active={type:'T',rotation:0,x:0,y:5};TetrisApp.game.queue[0]='O';TetrisApp.game.board[1][4]='Z'")
            c.key("Space")
            check("Blocked spawn shows game-over overlay", c.js("TetrisApp.game.state==='over' && document.getElementById('overlay-title').textContent==='Nicerun.' && !document.getElementById('game-overlay').hidden"))
            check("Game over stops the soundtrack", c.js("TetrisApp.music.source===null && !TetrisApp.music.wanted"))
            check("Game over plays a finale instead of being silenced by the overlay", c.js("TetrisApp.music.effects.has('over') && cueLog.filter(e=>e.kind==='over').length===1"))
            time.sleep(.10)
            check("Game-over cue is not restarted on subsequent animation frames", c.js("cueLog.filter(e=>e.kind==='over').length===1"))
            c.key("Enter")
            check("Enter restarts after game over", c.js("TetrisApp.game.state==='running' && TetrisApp.game.score===0 && TetrisApp.game.board.flat().every(x=>x===null)"))
            check("Restart cancels the old game-over melody", c.js("TetrisApp.music.effects.size===0"))
            for _ in range(12):
                c.key("Space"); c.key("KeyR")
            check("Repeated keyboard restarts reset gameplay without duplicate handlers", c.js("TetrisApp.game.score===0 && TetrisApp.game.piecesLocked===0 && TetrisApp.game.lines===0 && TetrisApp.game.queue.length===3 && TetrisApp.game.board.flat().every(x=>x===null)"))
            check("Repeated restarts reuse one context and one music buffer", c.js("TetrisApp.music.context===initialMusicContext && TetrisApp.music.buffer===initialMusicBuffer && TetrisApp.music.offset===0"))
            c.key("ArrowLeft")
            check("Movement is still single-step after repeated restarts", c.js("TetrisApp.game.active.x===2"))
            c.js("TetrisApp.game.score=123")
            c.key("KeyR", repeat=True)
            check("OS key repeat cannot repeatedly restart", c.js("TetrisApp.game.score===123"))
            c.click("#restart-button")
            check("Header restart button resets run and preserves best", c.js("TetrisApp.game.score===0 && document.getElementById('best').textContent==='800'"))
            # A visible, valid board for inspection of colors, ghost, grid, and preview.
            c.js("(() => {const g=TetrisApp.game;const rows=['JJJ...LLL.','JJOO.SSLL.','ZZOOSS.TTT'];rows.forEach((row,i)=>[...row].forEach((v,x)=>{g.board[19+i][x]=v==='.'?null:v}));g.active={type:'T',rotation:0,x:3,y:7};})()")
            time.sleep(.06)
            c.screenshot("desktop-playing.png")
            check("Desktop canvas has a nonempty rendered playfield", c.js("TetrisApp.renderer.context.getImageData(10,10,1,1).data[3]===255"))

            c.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)
            c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
            time.sleep(.15)
            c.screenshot("mobile-playing.png")
            check("Mobile layout has no horizontal overflow and visible touch controls", c.js("document.documentElement.scrollWidth<=innerWidth && getComputedStyle(document.querySelector('.touch-controls')).display!=='none' && document.querySelector('.touch-controls').getBoundingClientRect().bottom<=innerHeight"))
            c.js("TetrisApp.game.active={type:'T',rotation:0,x:3,y:5}")
            point = c.js("(() => {const r=document.querySelector('[data-action=left]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
            c.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{**point, "id": 1}])
            time.sleep(.2)
            c.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])
            time.sleep(.05)
            check("Real touch pointer moves and repeats left", c.js("TetrisApp.game.active.x<3 && document.querySelectorAll('.pressed').length===0"))
            x = c.js("TetrisApp.game.active.x")
            time.sleep(.15)
            check("Touch release stops repeat", c.js("TetrisApp.game.active.x") == x)
            for action_name, rotation in [('cw', 1), ('ccw', 0)]:
                c.click(f'[data-action="{action_name}"]')
                check(f"On-screen {action_name} rotation control works", c.js(f"TetrisApp.game.active.rotation==={rotation}"))
            c.click('[data-action="right"]')
            check("On-screen right control works", c.js("TetrisApp.game.active.x") == x + 1)
            score = c.js("TetrisApp.game.score")
            c.js("window.cueLog=[]")
            c.click('[data-action="down"]')
            check("On-screen soft drop scores once", c.js("TetrisApp.game.score") == score + 1)
            c.click('[data-action="drop"]')
            check("On-screen hard drop locks once, not twice", c.js("TetrisApp.game.piecesLocked===1"))
            check("Touch buttons trigger soft and hard drop cues once each", c.js("cueLog.filter(e=>e.kind==='soft').length===1 && cueLog.filter(e=>e.kind==='hard').length===1"))
            # Pointer cancellation must clear held controls.
            c.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{**point, "id": 1}])
            c.call("Input.dispatchTouchEvent", type="touchCancel", touchPoints=[])
            time.sleep(.05)
            check("Touch cancellation clears pressed state", c.js("document.querySelectorAll('.pressed').length===0"))
            for width, height in [(320, 568), (375, 667), (844, 390)]:
                c.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=width<641)
                time.sleep(.08)
                check(f"Responsive layout fits width at {width}x{height}", c.js("document.documentElement.scrollWidth<=innerWidth"))
                if width == 320:
                    c.key("KeyP")
                    c.screenshot("small-phone-paused.png")
                    check("Small-phone pause overlay fits inside the playfield", c.js("(() => {const content=document.querySelector('.overlay-content').getBoundingClientRect();const board=document.getElementById('board-shell').getBoundingClientRect();return content.top>=board.top && content.bottom<=board.bottom && document.getElementById('overlay-title').scrollWidth<=content.width;})()"))
                    c.key("KeyP")
            c.call("Emulation.setDeviceMetricsOverride", width=1100, height=850, deviceScaleFactor=1, mobile=False)
            # Additional sound fixtures must exercise actual input and completed clears.
            for count in [1, 2, 3]:
                c.key("KeyR")
                c.js(f"(() => {{const g=TetrisApp.game;window.cueLog=[];for(let y=22-{count};y<22;y++){{g.board[y].fill('J');g.board[y][4]=null;}}g.active={{type:'I',rotation:1,x:2,y:18}};}})()")
                c.key("Space")
                c.wait(f"TetrisApp.game.lines==={count} && cueLog.some(e=>e.kind==='clear')")
                check(f"{count}-line clear gets its own chime only after removal", c.js(f"cueLog.filter(e=>e.kind==='clear').length===1 && cueLog.some(e=>e.kind==='clear'&&e.count==={count}&&e.rows===0&&e.lines==={count}) && TetrisApp.music.effectBuffers.has('clear-{count}')"))
            c.key("KeyR")
            c.js("window.cueLog=[];TetrisApp.game.active={type:'O',rotation:0,x:3,y:20}")
            c.key("ArrowDown")
            check("Blocked soft drops are silent", c.js("cueLog.length===0 && TetrisApp.game.score===0"))
            c.key("Space")
            check("Zero-distance hard drop still confirms the successful lock with sound", c.js("cueLog.filter(e=>e.kind==='hard').length===1 && TetrisApp.game.piecesLocked===1"))
            c.key("KeyR")
            check("Rapid same-frame soft cues are throttled", c.js("(() => {const m=TetrisApp.music;return m.effect('soft') && !m.effect('soft') && !m.effect('soft');})()"))
            c.js("TetrisApp.music.effect('clear',4)")
            c.click("#music-button")
            check("Muting immediately cancels a playing reward chime", c.js("TetrisApp.music.effects.size===0 && TetrisApp.music.source===null"))
            c.click("#music-button")
            c.wait("TetrisApp.music.source!==null")
            c.js("TetrisApp.game.endGame()")
            c.wait("TetrisApp.music.effects.has('over')")
            c.js("window.dispatchEvent(new Event('blur'))")
            check("Losing focus silences the finale even after game over", c.js("TetrisApp.music.effects.size===0 && TetrisApp.game.state==='over'"))
            c.key("KeyR")
            c.js("TetrisApp.game.endGame()")
            c.wait("TetrisApp.music.effects.has('over')")
            c.wait("TetrisApp.music.effects.size===0")
            check("One-shot effects clean up their audio nodes when finished", c.js("TetrisApp.music.effects.size===0 && TetrisApp.music.context===initialMusicContext"))
            effects_stats = c.js("Array.from(TetrisApp.music.effectBuffers,([name,b])=>{const s=b.getChannelData(0);let peak=0,sum=0,finite=true;for(const v of s){finite=finite&&Number.isFinite(v);peak=Math.max(peak,Math.abs(v));sum+=v*v;}return {name,duration:b.duration,peak,rms:Math.sqrt(sum/s.length),finite,start:s[0],end:s[s.length-1]};})")
            check("All seven cue buffers have valid audible signal, quiet endpoints, and headroom", len(effects_stats)==7 and all(s["finite"] and .02<s["peak"]<=.231 and s["rms"]>.001 and abs(s["start"])<.001 and abs(s["end"])<.001 for s in effects_stats))
            check("Multi-line chimes become longer as the reward grows", c.js("[1,2,3].every(n=>TetrisApp.music.effectBuffers.get('clear-'+n).duration<TetrisApp.music.effectBuffers.get('clear-'+(n+1)).duration)"))
            c.click("#music-button")
            c.navigate(ROOT / "index.html")
            check("High score survives a page reload", c.js("document.getElementById('best').textContent==='800'"))
            check("Music mute preference survives reload without creating audio", c.js("!TetrisApp.music.enabled && TetrisApp.music.context===null"))
            c.js("localStorage.setItem('one-more-line.tetris.high-score.v1','not-a-score')")
            c.navigate(ROOT / "index.html")
            check("Malformed stored high score is safely reset", c.js("document.getElementById('best').textContent==='0'"))
            c.call("Page.addScriptToEvaluateOnNewDocument", source="Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError')}})")
            c.navigate(ROOT / "index.html")
            c.js("document.getElementById('primary-button').focus()")
            c.key("Space")
            check("Start button supports native keyboard Space activation", c.js("TetrisApp.game.state==='running'"))
            c.key("Space")
            check("Blocked localStorage does not prevent playing or scoring", c.js("TetrisApp.game.state==='running' && TetrisApp.game.score>0 && !document.getElementById('storage-note').hidden"))
            c.wait("TetrisApp.music.source!==null", timeout=10)
            check("Music remains usable when local storage is blocked", c.js("TetrisApp.music.available && TetrisApp.music.enabled"))
            c.js("TetrisApp.music.play(true);TetrisApp.music.pause()")
            time.sleep(.15)
            check("Rapid play/pause cannot resurrect a stale asynchronous music start", c.js("TetrisApp.music.source===null && !TetrisApp.music.wanted"))
            c.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
            check("Reduced-motion preference is honored", c.js("matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('.primary-button')).transitionDuration==='0s'"))
            c.js("1")  # Drain queued protocol events.
            errors = [event for event in c.events if event.get("method") == "Runtime.exceptionThrown" or (event.get("method") == "Log.entryAdded" and event.get("params", {}).get("entry", {}).get("level") == "error")]
            check("No browser JavaScript exceptions or console errors", not errors)
            remote_requests = [event for event in c.events if event.get("method") == "Network.requestWillBeSent" and event.get("params", {}).get("request", {}).get("url", "").startswith(("http://", "https://"))]
            check("Game and test pages make zero network requests", not remote_requests)
            report = {"browser": c.call("Browser.getVersion"), "engine": engine_results, "integration": results, "audio": audio_stats, "effects": effects_stats, "errors": errors}
            (ARTIFACTS / "results.json").write_text(json.dumps(report, indent=2) + "\n")
            for stale in ["failure.json", "failure.png"]:
                (ARTIFACTS / stale).unlink(missing_ok=True)
            print(f"\n{len(results)}/{len(results)} browser checks passed. Artifacts: {ARTIFACTS}", flush=True)
        except Exception as error:
            if client:
                try:
                    diagnostics = client.js("(() => {const m=window.TetrisApp?.music;return m ? {available:m.available,enabled:m.enabled,wanted:m.wanted,context:m.context?.state,time:m.context?.currentTime,buffer:!!m.buffer,pending:!!m.bufferPromise,generation:m.generation,gesture:navigator.userActivation.hasBeenActive} : {};})()")
                    print('Music diagnostics:', diagnostics, flush=True)
                    client.screenshot("failure.png")
                except Exception:
                    pass
            (ARTIFACTS / "failure.json").write_text(json.dumps({"passed": results, "error": str(error)}, indent=2) + "\n")
            raise
        finally:
            if client:
                client.socket.close()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
            log.close()


if __name__ == "__main__":
    main()
