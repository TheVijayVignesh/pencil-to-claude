# Pencil → Claude

Draw on your iPad with Apple Pencil, tap **Send to Claude**, and the drawing appears in the
message box of the Claude desktop app on your Mac, **unsent**, so you can add text and press Send yourself.

```
iPad (Safari / Home Screen app)  ──Wi‑Fi──▶  Mac relay (Node, :8787)  ──clipboard + ⌘V──▶  Claude app composer
```

## Features

**Drawing (iPad)**
- Pen with Apple Pencil pressure, highlighter, eraser
- 8 colors + custom color picker; thickness slider with live preview
- Undo / redo, Clear (toolbar trash or the button next to Send; Undo brings a cleared page back)
- Endless vertical page for long work (e.g. math): fingers scroll with momentum, **↑ Back to top** pill
- Palm rejection ("Pencil only"): switches on by itself the first time the Pencil touches the screen.
  On: Pencil draws, one finger scrolls. Off: one finger draws, two fingers scroll.
- Light / dark page (moon button). The first swatch is "ink": black on light, off‑white on dark.
- Low‑latency inking: strokes are drawn incrementally from each pointer event, with Pencil prediction
- The drawing auto‑saves on the iPad, so a reload or app switch doesn't lose it

**Sending**
- **Open session** (default): pastes into whichever Claude session (chat or Code) is on screen.
  If Claude isn't running or has no window, starts a new **chat** or **code session** (your choice, set under the buttons).
- **New chat** / **New code**: always start a fresh session, then paste.
- Sends the whole page, cropped to what you drew, on the current page color (max 4000 px tall).
- Status pill (bottom left) shows whether Claude is open on the Mac.
- Every drawing is also saved as a PNG in `data/drawings/` next to the running relay.

## How it works

| Piece | File | What it does |
|---|---|---|
| Drawing app | `public/index.html` | Single‑file web app (canvas + Pointer Events). Exports a PNG and POSTs it to the relay. |
| Relay | `server.mjs` | Node HTTP server, no dependencies. Serves the app, checks the pairing token, saves the PNG, puts it on the clipboard and pastes into Claude via AppleScript. |
| Launcher | `launcher/main.swift` | Tiny `PencilRelay.app` that runs the relay as a child, so macOS permissions are granted to *PencilRelay*, not to every Node script. |
| Start / restart | `start.sh` | Restarts the relay (or installs it if missing), syncs edits, prints the iPad link. |
| Install | `install.sh` / `uninstall.sh` | Installs to `~/Library/Application Support/PencilToClaude` and registers a LaunchAgent (starts at login, restarts on crash). |

Delivery details (`server.mjs`):
1. Image goes onto the clipboard (`«class PNGf»`).
2. *Open session*: `activate` Claude. *New chat/code*: open `claude://claude.ai/new?surface=chat` or `claude://code/new`, wait for the window and composer.
3. Paste (⌘V) only if Claude is actually frontmost; otherwise the iPad shows an error and nothing is pasted anywhere else.
4. Sends are queued so two quick taps can't interleave.

Security: the relay listens on your LAN and only accepts requests carrying the pairing token from
`data/config.json` (generated on first run). Anyone with the pairing link can paste images into your Claude app, so don't share it.

## If it stops: `./start.sh`

```bash
cd ~/Documents/Projects/Pencil-to-Claude && ./start.sh
```

Starts or restarts the relay, copies in any edits from this folder, and prints the iPad link.
If the relay was never installed (or was uninstalled), it runs `install.sh` for you.
It never rebuilds PencilRelay.app, so your Accessibility permission stays intact.
If macOS is blocking the paste, it tells you so.

## Setup

Requirements: macOS with the Claude desktop app, Node 18+, Xcode command‑line tools (`swiftc`), iPad on the same Wi‑Fi.

1. **Install the relay** (starts now and at every login):
   ```bash
   ./install.sh
   ```
2. **Grant permissions** (once):
   - System Settings → Privacy & Security → **Accessibility** → enable **PencilRelay**
     (or add `~/Library/Application Support/PencilToClaude/PencilRelay.app` with **+**).
   - On the first send, allow PencilRelay to control **System Events** and **Claude**.
   - If macOS' firewall blocks Node, allow incoming connections for your `node` binary
     (System Settings → Network → Firewall → Options).
   - After granting Accessibility, restart the relay once:
     ```bash
     launchctl kickstart -k gui/$(id -u)/com.vijayvignesh.pencil-to-claude
     ```
3. **Pair the iPad**: open the link printed in the log in Safari, then Share → **Add to Home Screen**.
   ```bash
   grep -m1 -A1 "Open on your iPad" ~/Library/Logs/PencilToClaude.log
   ```

To run it ad hoc instead (e.g. while developing): `node server.mjs` (stop the LaunchAgent first, since both use port 8787).

## Updating

- Edited `public/index.html` or `server.mjs`? Run `./start.sh`. It copies them into place and restarts.
- Re‑running `install.sh` rebuilds PencilRelay.app, which **resets its Accessibility permission**. Re‑enable it afterwards.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Anything stopped working | Run `./start.sh` first. |
| iPad: "can't open page" | Run `./start.sh`. Same Wi‑Fi? Firewall allowing `node`? Try the IP link from the log. Campus/office Wi‑Fi may block device‑to‑device traffic; use a phone hotspot. |
| "Mac blocked the paste" | Enable PencilRelay in Accessibility, then restart the relay (command above). |
| "Claude didn't come to the front" | Claude is minimized or on another Space; bring it up and send again. |
| Status says "Not paired" | Open the full pairing link (with `?t=`) again; re‑add to Home Screen. |
| Logs | `~/Library/Logs/PencilToClaude.log` |

Note: each send replaces the Mac clipboard with the drawing.

## Uninstall

```bash
./uninstall.sh
```
Stops the relay and removes it from login. Remove `~/Library/Application Support/PencilToClaude` to delete the app and saved drawings.
