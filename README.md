Jacquardesque
=============

**Jacquardesque** is a public fork and full **Web Audio** port of
[**keijiro/Jacquard**](https://github.com/keijiro/Jacquard) by
[Keijiro Takahashi](https://github.com/keijiro).

Jacquard remains the upstream Unity prototype. Jacquardesque keeps that
provenance visible: this is a fork and a browser port of that work, not an
independent reimplementation without credit.

| | |
| --- | --- |
| Upstream | [github.com/keijiro/Jacquard](https://github.com/keijiro/Jacquard) |
| This fork | [github.com/williamsharkey/jacardesque](https://github.com/williamsharkey/jacardesque) |
| **Play in the browser** | **[williamsharkey.github.io/jacardesque](https://williamsharkey.github.io/jacardesque/)** |

Play the demo
-------------

**[https://williamsharkey.github.io/jacardesque/](https://williamsharkey.github.io/jacardesque/)**

Click **Play** (or press Space). Browsers require a gesture before audio starts.

The web app is a no-compromise port of the prototype’s behaviour:

- Sample-accurate scheduling on the audio clock (`AudioWorklet`)
- Two-operator FM voice pool with voice stealing (same maths as the Unity core)
- Freeverb reverb + tempo-locked delay with rate-limited tap (same buses)
- Full plane editor: lanes anywhere, stacks, gates, locks, jumps / JDST
- Parameter locks (absolute / relative) on every patch field including pan & sends
- Sound / Lock / Send FX panels, value bars, file slots in `localStorage`
- Same text score format (`.jacquard` v8)

The original static look mockup is still at
[docs/mockup.html](docs/mockup.html) (also linked from the live site).

About Jacquard (upstream)
-------------------------

A prototype grid sequencer. Lanes of steps are laid out anywhere on one plane; a
step stacks what happens at the same instant; gates, parameter locks and jumps
turn sixteen slots into something that changes as it repeats.

Built with Unity 6.5 (6000.5.6f1). Open the project and play `Assets/Main.unity`.

Using it (web and Unity)
------------------------

| Action | How |
| --- | --- |
| Move the cursor | Click a cell, or the arrow keys |
| Write a note | Double click a free cell, or its `NOTE` button on the Tile panel |
| Transpose | Shift+up/down for a semitone, add command/ctrl for an octave |
| Add a gate or a lock | The buttons the Tile panel offers on a free cell |
| Remove a tile | Delete on the Tile panel, or the delete key |
| Move a tile | Drag it; within its own step that reorders the stack |
| Move a sub-stack | Drag a tile to another step, and what hangs below it comes too |
| Move a lane | Drag its `CHAN` or `JDST` cell |
| Lengthen a lane | Put a tile on its `TERM` cell, or use Steps on its `CHAN` cell |
| New lane | Select bare ground, then New lane; delete a lane from its `CHAN` cell |
| Branch | The `JUMP` button, which brings its `JDST` lane with it |
| Details of a tile | The panel on the right follows the cursor |
| Set a number | Drag its bar right or up; double click to type one |
| Timbre | Select a `CHAN` cell, which brings up the Sound panel for its channel |
| Reverb and delay | The Send FX button opens the panel they are set on; how much of a channel reaches each is the last two rows of its Sound panel |
| What a lock holds | Select it, then move a bar on the Lock panel; click a name to let go |
| Play | Space, or the Play button |
| Tempo | The bpm bar beside Play, which the delay is in time with |
| Pan the plane | Drag from an empty cell |

A tile goes on free ground only: a lane's empty step, the cell under a stack, or
the `TERM` cell, which grows the lane by a step. A stack is therefore built from
the top down, the gate first and the note it governs in the cell underneath it,
which is the order the runner reads it in. A new note arrives at the pitch and
length of the last note edited.

Dragging is the exception: a tile dropped on an occupied cell opens the stack up
and takes its place, which is how one is reordered. A drop with nowhere to go —
off any lane, or with no room under the stack it would join — leaves nothing lit
up on the plane and does not happen.

A lane holds its whole row from `CHAN` to `TERM` whether anything is written on
it yet or not, so nothing else can grow across it and no lane can be dropped on
one. Give a lane a clear row of its own and it will take tiles anywhere along it.

Scores: Unity saves under `Application.persistentDataPath/Scores`; the web port
saves named slots in `localStorage` as the same plain-text format.

Web architecture
----------------

| Path | Role |
| --- | --- |
| `docs/js/core.js` | Model, format, sequencer (port of `Assets/Core`) |
| `docs/js/processor.js` | `AudioWorklet` FM pool, reverb, delay |
| `docs/js/audio.js` | Main-thread clock / note bridge |
| `docs/js/editor.js` | Editing operations |
| `docs/js/ui.js` | Score plane + panels |
| `docs/js/main.js` | App glue |
| `docs/index.html` | GitHub Pages entry |

Local preview: serve `docs/` over HTTP (modules + worklets need a server), e.g.

```bash
npm run serve
# open http://localhost:8080/
```

Tests:

```bash
npm install          # once — puppeteer-core for browser smoke
npm test             # core model / format / sequencer / offline FM
npm run test:browser # headless Chrome: UI + AudioWorklet + Play
```

Documentation
-------------

| | |
| --- | --- |
| [docs/prototype.md] | What this prototype is for |
| [docs/sequencer.md] | The sequencer specification |
| [docs/mockup.html] | The static mockup the look comes from |
| [docs/implementation.md] | How the Unity build is put together |

[docs/prototype.md]: docs/prototype.md
[docs/sequencer.md]: docs/sequencer.md
[docs/mockup.html]: docs/mockup.html
[docs/implementation.md]: docs/implementation.md

Credit
------

Original project: **[Jacquard](https://github.com/keijiro/Jacquard)** by
**[Keijiro Takahashi](https://github.com/keijiro)** ([@keijiro](https://github.com/keijiro)).

FM voice and UI patterns draw on the same author’s related work
([unity-sap-test](https://github.com/keijiro/unity-sap-test),
[uitk-scrollarea](https://github.com/keijiro/uitk-scrollarea)).

Please prefer starring and following the upstream repository for the author’s work.
