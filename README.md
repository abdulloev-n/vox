# Vox

Voice dictation for Windows that cleans up what you say.

Press a hotkey, talk, and Vox pastes clean text into whatever field has focus. It drops filler words ("um", "uh", "like"), repeats and false starts, fixes punctuation, and keeps the language you spoke. Speech in any language works, including a mix of languages in one sentence.

## Features

- **Two hotkeys.** Hold `Ctrl + R` to record while the keys are down. Press `Ctrl + Shift + R` to start, then press it again to stop. `Esc` cancels a recording. Both combinations can be changed in Settings.
- **Small recording widget.** A pill at the bottom of the screen shows a live waveform while you talk and a flat line when you are silent. It never takes focus from the app you are typing in.
- **Text cleanup with an on/off switch.** Turn cleanup off to paste the raw transcript.
- **Two output styles.** "As typed" gives a plain message. "AI prompt" turns the dictation into a clear task with details.
- **Automatic paste.** The text goes into the active field with Ctrl+V, and your previous clipboard text comes back afterwards.
- **History.** Every dictation is stored with its time, duration, language, the raw transcript, and the cleaned result. Search, copy, delete (with undo), or erase everything.
- **Dictionary.** List names and terms that must be spelled exactly.
- **Any model.** Type any OpenAI transcription model and any chat model your key can use.
- **Private by design.** Audio stays in memory and is never written to disk. Only text is saved, and you choose how long it is kept.

## How it works

1. Vox records from your microphone while the hotkey is active.
2. The audio is sent to the OpenAI transcription API (`gpt-4o-transcribe` by default). The language is detected automatically.
3. If cleanup is on, the transcript goes to a chat model (`gpt-4o-mini` by default) with strict instructions to clean the text without answering it, translating it, or adding anything.
4. Vox pastes the result into the active window.

Audio is sent to OpenAI for transcription. If that is a problem for you, do not use this app.

## Requirements

- Windows 10 or 11
- An [OpenAI API key](https://platform.openai.com/api-keys)
- [Node.js](https://nodejs.org) 20 or newer (only to run from source)

## Run from source

```bash
git clone https://github.com/abdulloev-n/vox.git
cd vox
npm install
npm start
```

If npm blocks install scripts and Electron does not download, run:

```bash
node node_modules/electron/install.js
```

On first launch Vox opens Settings. Paste your API key and press Save. The key is encrypted with Windows secure storage and kept only on your computer.

## Build an installer

```bash
npm run dist
```

The installer appears in `dist/` as `Vox Setup <version>.exe`. It is not code-signed, so Windows SmartScreen shows a warning. Choose "More info", then "Run anyway".

## Settings

| Setting | What it does |
| --- | --- |
| Text cleanup | Turns the cleanup step on or off. Also available in the sidebar and the tray menu. |
| Output style | "As typed" or "AI prompt". |
| Dictionary | Terms to spell exactly, one per line. |
| Hotkeys | Change both recording combinations. |
| API key | Paste, replace, or remove your OpenAI key. |
| Transcription model | Any speech-to-text model name your key can use. |
| Cleanup model | Any chat model name your key can use. |
| Microphone | Pick a recording device. |
| Memory | How many days and how many entries to keep. |
| Launch with Windows | Starts Vox in the tray at login. |

## Good to know

- Vox registers `Ctrl + R` as a global shortcut, so other apps do not receive it while Vox runs. Pick a different combination in Settings if that gets in the way.
- Pasting into windows that run as administrator does not work unless Vox runs as administrator too.
- Recordings shorter than half a second or almost silent are skipped.
- Recognition quality depends on the model and the language. Test your own languages.

## Project structure

```
main.js            Electron main process: windows, tray, hotkeys, recording pipeline
preload.js         Safe bridge between the main process and the windows
lib/openai.js      Transcription and cleanup requests
lib/paste.js       Clipboard and Ctrl+V handling
lib/hotkey.js      Global key listener and hotkey recording
lib/store.js       Settings, encrypted API key, history
renderer/          History and settings window, recording widget
scripts/           Icon generator and small diagnostic tools
```

## License

MIT. See [LICENSE](LICENSE).
