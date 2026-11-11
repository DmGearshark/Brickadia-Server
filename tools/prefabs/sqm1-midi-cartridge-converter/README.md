# SQM1 MIDI Cartridge Converter

This offline tool converts a Standard MIDI file into an automatic `.brz`
cartridge for the 24-lane SQM1 V10.1 music player. The recommended V4 Pitch
Continuity mode uses the same voice-assignment priorities as the approved
**His Theme V4** cartridge: preserve note attacks first, preserve sustain
second, and keep each voice's pitch motion natural third.

## Use it on Windows

1. Extract the release ZIP.
2. Double-click `SQM1-MIDI-Cartridge-Converter.html`. A current Chrome, Edge,
   or Firefox installation is sufficient; the tool does not need an internet
   connection.
3. Drop a `.mid` or `.midi` file onto the page, or select **Choose MIDI**.
4. Set the song name. Leave **V4 Pitch Continuity** selected for the normal
   high-quality conversion.
5. Select **Build & Download Cartridge** and save the generated `.brz` file.
6. Import the `.brz` into Brickadia. Spawn the cartridge through a **Prefab
   Spawner** when using automatic load-and-delete behavior; directly pasting a
   saved cartridge does not give it a spawned prefab entity to delete.

All parsing, arrangement, and cartridge creation run locally in the browser.
The MIDI file is never uploaded.

## What the converter supports

- Standard MIDI formats 0 and 1, including PPQ and SMPTE time divisions
- Tempo changes, sustain pedal, running status, overlapping notes, program
  changes, and channel-mode note termination
- Up to 24 output voices and 65,536 SQM1 Quaternion array entries
- Octave folding into the player's practical MIDI range of 30 through 108
- A player-selected output instrument: source MIDI instruments are flattened
  so the instrument buttons on the SQM1 player remain in control

Percussion channel notes are rejected by the recommended mode rather than
silently mapping drums to pitched sine notes. MIDI expression that the SQM1
score format cannot reproduce, such as pitch bend, aftertouch, or expression
controllers, appears in the conversion warnings. Dense songs can require
shorter note tails to fit the available voices; the page reports every such
cut and the total sustain removed.

## Command line from the release ZIP

The ZIP also contains one self-contained
`sqm1-midi-cartridge-converter.cjs` command-line program. It has the production
cartridge template and all JavaScript dependencies embedded. With Node.js 22
or newer installed, open Command Prompt or PowerShell in the extracted release
folder and run:

```powershell
node sqm1-midi-cartridge-converter.cjs "C:\Music\song.mid" "C:\Music\song-cartridge.brz" --title "Song Name"
```

The extracted CLI does not need `npm`, `npm ci`, `node_modules`, the repository,
or an internet connection.

V4 quality, 24 voices, and a 0.20-second release reservation are the CLI
defaults. Run `node sqm1-midi-cartridge-converter.cjs --help` for the strict
preset, voice/release controls, JSON report output, percussion opt-in, and
unsupported-expression checks. The CLI uses its embedded production cartridge
template unless `--template` selects another one.

## Build from source

From a repository checkout, install the pinned development dependencies, then
rebuild the self-contained release ZIP:

```powershell
cd tools\prefabs
npm ci
node build-sqm1-midi-converter-release.cjs --output sqm1-midi-cartridge-converter\SQM1-MIDI-Cartridge-Converter.zip
```

Run the focused converter tests from `tools\prefabs`:

```powershell
node test-sqm1-midi-converter-core.cjs
node test-sqm1-pitch-continuity-arranger.cjs
node test-sqm1-browser-cartridge-core.cjs
node test-sqm1-midi-cartridge-converter.cjs
node test-sqm1-midi-converter-ui.cjs
node test-sqm1-midi-converter-release.cjs
```

The generated HTML includes the production automatic-cartridge template and
all required JavaScript. It has no external script, style, font, or network
dependency.

## License notices

See `THIRD-PARTY-NOTICES.txt` for the libraries used to read and write
Brickadia saves and to build the standalone browser release.
