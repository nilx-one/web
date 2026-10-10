# Character voices

The characters speak aloud. xSasha says her lines in a cutscene, and an Avaia
can say its own as it walks. Every fixed line was rendered ahead of time, in
the voice of whoever says it, and the client plays the recording when the line
is said. The written line stays the fact: it
is on the card and in the live region whether or not anything is heard. This is
stage 1. Lines nobody can write down in advance (a landmark's name, a line a
[local model](local-models.md) rephrases) need speech on the device. That is
stage 2.

## Who is heard, and when

Settings has **Character voices** under Sound: one slider of three stops,
stored on this device (`nilx-one.interface.voice`).

| Stop                   | Heard                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Off                    | nobody                                                                               |
| Cutscenes, the default | characters other than the person, in a cutscene: xSasha, and whoever joins her later |
| Everything             | also the Avaia's own lines as it walks                                               |

A person's own words are never voiced: the replies they choose in a cutscene
stay written only. The product does not put a voice in anyone's mouth, and
people rarely like hearing a voice that is supposed to be theirs. With sound
itself off the slider rests at Off and waits; the stored choice comes back with
sound. An Avaia's walking lines are the loudest stop because the person is
driving it; when the Bond drives and an Avaia speaks in a cutscene, it will be
heard at Cutscenes like any other character.

## Who speaks how

| Study     | English (Kokoro) | Ukrainian (Piper `ukrainian_tts`)           |
| --------- | ---------------- | ------------------------------------------- |
| Sky       | `am_michael`     | `mykyta`, a touch slower                    |
| Dasha     | `af_bella`       | `tetiana`, a touch quicker                  |
| Kai       | `bm_lewis`       | `mykyta`, flat and slow, 1.5 semitones down |
| Dasha 2.0 | `bf_emma`        | `lada`                                      |

xSasha speaks in the gender of the study she is drawn in, which mirrors the
Bond's (`guideModel`): feminine as either Dasha, masculine as Sky. She is never
drawn as Kai, so her neutral wordings are not recorded. Her voices are her own
settings, not an Avaia's:

| xSasha drawn as  | English (Kokoro) | Ukrainian (Piper `ukrainian_tts`) |
| ---------------- | ---------------- | --------------------------------- |
| Dasha, Dasha 2.0 | `af_sarah`       | `lada`, 1.5 semitones up          |
| Sky              | `am_adam`        | `mykyta`, 2 semitones up          |

The tables are `tools/voices/voices.json`. Kai's Ukrainian voice is the same
speaker as Sky's, told to keep its intonation flat (a low noise scale) and
pitched down without moving its formants: deadpan, and still Kai's. Sky and Kai
are masculine-sounding in both languages, which matches the grammar their
Ukrainian lines already use.

## What is recorded, and what is not

- **Recorded:** the 26 fixed lines of every study (walking, the three refusals,
  and the fog lines), and xSasha's 15 lines in each of her two voices, in
  English and Ukrainian: 268 clips, a few seconds each, mono MP3 at 48 kbit/s.
- **Said without the name:** nine of xSasha's lines carry a name the moment
  fills in (`{bond}`, `{avaia}`). The card shows it; the voice says a wording
  without it (`tools/voices/spoken.json`), because an address like `0x0sky`
  is not something to spell out. "Almost forgot — here, 0x0sky." is heard as
  "Almost forgot — here." The render refuses a line that still carries a
  placeholder.
- **Not recorded:** lines about a landmark. They carry its name, which only the
  moment knows. They stay text until stage 2.
- **Not recorded yet:** xSasha's backpack gift ([xSasha](guide.md),
  "Backpacks"). The node says `recorded: false`, so the line is typed out and
  never asked for, and the asset test leaves it out until a render adds it.
- **Not recorded: Russian.** No Russian voice we could find has a license that
  allows this product. Piper's `denis` and `dmitri` are fine-tuned from the
  `lessac` voice, whose Blizzard 2013 dataset is licensed for non-commercial use
  only. `ruslan` is CC BY-NC-SA. `irina` states no license. Kokoro has no
  Russian. Russian lines stay text, and Settings says so.

## Licenses, as checked

Checked against the model cards and licenses inside each archive, not from
memory:

| Model                                | What its own files say                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Kokoro-82M v0.19 (`kokoro-en-v0_19`) | `LICENSE`: Apache-2.0                                                    |
| Piper `uk_UA-ukrainian_tts-medium`   | `MODEL_CARD`: trained from scratch; dataset NabuCasa/voice-datasets, CC0 |
| Whisper large-v3-turbo (judge only)  | MIT. It listens to takes; nothing it produces is shipped                 |

Kokoro's authors describe its training data as permissively licensed, public
domain, and synthetic audio from large commercial TTS providers. Its weights
are Apache-2.0. The Ukrainian speakers come from Yehor Smoliakov's Open Source
Ukrainian TTS datasets (Apache-2.0). Piper's own engine is MIT up to its
archived `rhasspy/piper` repository and GPL-3.0 since it moved to
`OHF-Voice/piper1-gpl`; neither is used here. The Ukrainian voice runs directly
in ONNX Runtime.

## How a clip is made

`tools/voices/render.py`, offline, on a contributor's machine:

1. **Lines.** `export-lines.mjs` reads the catalog from the TypeScript source
   itself, so nothing is copied by hand.
2. **Speakable text.** Typography a voice cannot say is dropped (the ellipsis,
   guillemets, Kai's deadpan "(1)"). Words a voice would misread are respelled
   from `pronunciation.json`.
3. **Ukrainian stress.** The voice was trained on text marked with combining
   acute accents, and reads stress wrong without them. `ukrainian-word-stress`
   marks them from its dictionary, without its stanza backend. About thirty
   words it gets wrong for these lines (`іду́`, not `І́ду`; `нови́й о́браз`, not
   `Но́вий образ`) are fixed in `pronunciation.json`.
4. **Synthesis.** English runs through sherpa-onnx's Kokoro. The Ukrainian
   voice is fed to ONNX Runtime directly, the way Piper feeds a
   `phoneme_type: text` voice. Its sherpa-onnx bundle declares an espeak front
   end the model was never trained on, and through it the voice says nothing
   intelligible.
5. **Finishing.** Silence is trimmed gently (a soft final consonant sits far
   below a word's peak, and an eager trim swallows the word). Every clip is
   brought to −20 dBFS RMS under a −1.5 dBFS ceiling, so no study is louder
   than another, and gets 8 ms fades.
6. **Judging.** Each line is synthesised up to three times. Whisper turbo
   transcribes every take, and the take with the lowest character error rate
   against the spoken text is kept. Kokoro takes vary the pace, and only
   downward: hurried, it swallows a sentence's last word. Whisper misjudges
   short clips two opposite ways. One that ends right on its last word is
   often heard cut short, and the same clip padded with silence is sometimes
   heard twice over. So every take is heard both ways and the closer reading
   counts, and an echo the line itself does not have is not held against
   it. `--retry-above 0.1 --takes 8` renders the weakest lines again. In
   0.1.0, 185 of 208 clips are heard word for word and none is worse than
   14%; what remains is mostly the judge ("Avaia" heard as "Avea").
7. **Encoding** to `deploy/web/voices/<version>/<locale>/<study>/<kind>.<n>.mp3`,
   with `manifest.json` recording, per clip, the line, what the voice was
   asked to say, what the judge heard, its error rate, and its SHA-256.

```sh
sh tools/voices/build.sh                                  # every line
sh tools/voices/build.sh --only uk-UA/kai-study/walk.7    # one line again
python tools/voices/render.py --rejudge                   # listen again
python tools/voices/render.py --retry-above 0.1 --takes 8 # redo the weakest
python tools/voices/render.py --dry-run                   # what would be said
```

Models download once into `tools/voices/.cache` from k2-fsa/sherpa-onnx
releases and are verified against the SHA-256 in `models.json` before use.

**The clips are committed.** A neural voice is not bit-for-bit reproducible,
even on one machine, so the repository cannot pin hashes and regenerate the
clips in CI the way it does avatars. A recording is also something a person
listens to before it ships. A re-render is a new version directory, never new
bytes under an old path.

## In the client

- `avaiaVoiceUrl` (`avaia-voice.ts`) finds a line's recording by the line
  itself: its locale, study, kind, and its index in the catalog. A line with no
  recording answers `undefined`, and nothing is played.
- The host says it through `SoundCapability.speak`. The browser fetches the
  clip from the product's own origin (through the Discord proxy inside an
  Activity), decodes it once and keeps the last 48. It plays the clip 120 ms
  after the cue that comes with the line, on its own bus, with the world's bed
  dipped under it. One voice says one thing at a time: a new line cuts off the
  one before it. A clip not ready within 2.5 s is dropped, like a late cue.
- `guideVoiceUrl` finds one of xSasha's lines by its catalogue key and the
  voice she said it in. The world view says it when the line opens, once; a
  reply never reaches `speak`.
- **Character voices** in Settings decides who is heard (see above).
- Caddy serves `/voices/*` with immutable caching. The image copies
  `deploy/web/voices`.

`tests/deployment/avaia-voice-assets.test.ts` holds the recordings to the
catalog: every fixed line has a clip and every clip has a line, the text
matches, the bytes match the manifest, every study has a voice, the judge
understood every clip, and the routes exist. A line edited in `avaia-lines.ts`
without a re-render fails that test, so a voice never says words the card no
longer shows.

## Not yet

- **Stage 2: speech on the device.** Landmark lines and model rephrasings need
  a voice that runs in the browser. Piper's VITS voices run in ONNX Runtime
  Web, and the Ukrainian one is about 73 MB. That is the next step.
- **Russian.** It is waiting for a voice with a usable license.
- **How "Avaia" sounds.** Ukrainian says `ава́я`. English leaves the name to
  Kokoro, and Whisper hears it as "Aver". The name deserves a decision.

---

© 2026 aiaiaiai · aiaiaiai.org
