Jacquardesque
=============

**Jacquardesque** is a public fork of
[**keijiro/Jacquard**](https://github.com/keijiro/Jacquard) by
[Keijiro Takahashi](https://github.com/keijiro).

This repository starts from that project so we can experiment and extend it
while giving clear credit to the original work. Jacquard itself remains the
upstream prototype; Jacquardesque is not a rebrand of the original author’s
project.

| | |
| --- | --- |
| Upstream | [github.com/keijiro/Jacquard](https://github.com/keijiro/Jacquard) |
| This fork | [github.com/williamsharkey/jacardesque](https://github.com/williamsharkey/jacardesque) |
| Play the demo | [williamsharkey.github.io/jacardesque](https://williamsharkey.github.io/jacardesque/) |

Play the demo
-------------

The browser demo is the static UI mockup from the original project, published
via **GitHub Pages**:

**[https://williamsharkey.github.io/jacardesque/](https://williamsharkey.github.io/jacardesque/)**

(Also available as [`docs/mockup.html`](docs/mockup.html) in this repo.)

The full interactive sequencer is a Unity project (see below). The Pages demo
is the look/layout mockup, not a WebGL build of the Unity app.

About Jacquard (upstream)
-------------------------

A prototype grid sequencer. Lanes of steps are laid out anywhere on one plane; a
step stacks what happens at the same instant; gates, parameter locks and jumps
turn sixteen slots into something that changes as it repeats.

Built with Unity 6.5 (6000.5.6f1). Open the project and play `Assets/Main.unity`.

Using it
--------

| Action | How |
| --- | --- |
| Move the cursor | Click a cell, or the arrow keys |
| Write a note | Double click a free cell, or its `NOTE` button on the Tile panel |
| Transpose | Shift+up/down for a semitone, add command for an octave |
| Add a gate or a lock | The buttons the Tile panel offers on a free cell |
| Remove a tile | Delete on the Tile panel, or the delete key |
| Move a tile | Drag it; within its own step that reorders the stack |
| Move a sub-stack | Drag a tile to another step, and what hangs below it comes too |
| Move a lane | Drag its `CHAN` or `JDST` cell |
| Lengthen a lane | Put a tile on its `TERM` cell, or use Steps on its `CHAN` cell |
| New lane | Select bare ground, then New lane; delete a lane from its `CHAN` cell |
| Branch | The `JUMP` button, which brings its `JDST` lane with it |
| Details of a tile | The panel on the right follows the cursor |
| Set a number | Drag its bar right or up, shift for fine; double click to type one |
| Timbre | Select a `CHAN` cell, which brings up the Sound panel for its channel |
| Reverb and delay | The Send FX button opens the panel they are set on; how much of a channel reaches each is the last two rows of its Sound panel |
| What a lock holds | Select it, then move a bar on the Lock panel; click a name to let go |
| Play | Space, or the Play button |
| Tempo | The bpm bar beside Play, which the delay is in time with |
| Pan the plane | Drag from an empty cell, two finger swipe, or command+drag |

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

Scores are saved under `Application.persistentDataPath/Scores` as plain text,
one line per step; pick a slot with the File arrows.

Documentation
-------------

| | |
| --- | --- |
| [docs/prototype.md] | What this prototype is for |
| [docs/sequencer.md] | The sequencer specification |
| [docs/mockup.html] | The static mockup the look comes from (also the GitHub Pages demo) |
| [docs/implementation.md] | How it is built, and the decisions behind it |

[docs/prototype.md]: docs/prototype.md
[docs/sequencer.md]: docs/sequencer.md
[docs/mockup.html]: docs/mockup.html
[docs/implementation.md]: docs/implementation.md

Credit
------

Original project: **[Jacquard](https://github.com/keijiro/Jacquard)** by
**[Keijiro Takahashi](https://github.com/keijiro)** ([@keijiro](https://github.com/keijiro)).

Jacquardesque keeps that provenance visible: this is a fork, not an independent
reimplementation. Please prefer starring and following the upstream repository
for the author’s work.
