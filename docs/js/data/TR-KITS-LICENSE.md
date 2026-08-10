# TR drum sample packs — license & sources

These one-shot banks power the **TR-606 / TR-707 / TR-808 / TR-909** drum-machine
instruments in Jacquardesque. Each machine is a **single object** with pads
(not one instrument per drum sound).

## Sources

| Kit | Source | License notes |
|-----|--------|----------------|
| **TR-707** | [fluid-music/open-drums](https://github.com/fluid-music/open-drums) `tr-707` (hyperreal.org machines archive) | Package **ISC** |
| **TR-808** | Same repo `tr-808` (hyperreal / Michael Fischer “ABSOLUTELY FREE” lineage) | Package **ISC**; Fischer set historically released free for any use |
| **TR-909** | Same repo `tr-909` (hyperreal TR-909 archive) | Free redistribution via open-drums |
| **TR-606** | Derivative of the 808 bank (high-pass + shorter envelope) for 606 character | Same ISC lineage as 808 |

Packed form: `docs/js/data/tr-kits.json` (22.05 kHz mono PCM, ≤0.32 s per pad).

## Trademarks

“TR-606”, “TR-707”, “TR-808”, “TR-909” and “Roland” are trademarks of Roland
Corporation. These packs are independent recreations / free archives and are
**not** affiliated with or endorsed by Roland.

## Rebuild

If you have `sox` and network access:

```bash
# See session tooling / re-run the download+pack pipeline used to create tr-kits.json
```
