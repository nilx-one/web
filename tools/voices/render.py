# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Renders every fixed line an Avaia says into a short MP3, offline.

Each study speaks with its own voice in each locale (voices.json). A line is
synthesised several times, every take is transcribed by Whisper, and the take
it understood best is kept. Nothing here runs in the product: the clips this
writes are committed, and the client only plays them.

    python tools/voices/render.py                  # every line
    python tools/voices/render.py --only uk-UA/kai-study/walk.7
    python tools/voices/render.py --dry-run        # print what would be said

Models are downloaded once into tools/voices/.cache and verified against the
SHA-256 in models.json before anything is loaded.
"""

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import tarfile
import tempfile
import unicodedata
import urllib.request
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / ".cache"

# Loudness every clip is brought to, so no study is louder than another.
TARGET_RMS_DBFS = -20.0
PEAK_CEILING_DBFS = -1.5
# Silence around the words, kept so a clip does not start or end on a click.
# Generous on purpose: a word's soft ending sits far below its peak, and a
# trim that reaches it swallows the word (Whisper stops hearing "been").
LEAD_SECONDS = 0.06
TAIL_SECONDS = 0.25
SILENCE_SHARE = 0.005
FADE_SECONDS = 0.008
MP3_BITRATE = "48k"
# Silence the judge hears around a take; not part of the clip.
JUDGE_LEAD_SECONDS = 0.3
JUDGE_TAIL_SECONDS = 0.6


def load_json(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


# ─── text ────────────────────────────────────────────────────────────────


def spoken_text(text, locale, pronunciation):
    """What the voice is asked to say: the written line, made speakable.

    Typography the eye reads but a voice cannot (ellipses, guillemets, the
    "(1)" a deadpan line uses as a joke) is dropped, and words the voice would
    misread are respelled from pronunciation.json.
    """
    spoken = text.replace("…", ".").replace("«", "").replace("»", "")
    spoken = spoken.replace("“", "").replace("”", "").replace('"', "")
    spoken = re.sub(r"\s*\(\d+\)", "", spoken)
    spoken = spoken.replace("’", "'").replace("ʼ", "'")
    for written, said in pronunciation.get(locale, {}).items():
        spoken = re.sub(rf"(?<!\w){re.escape(written)}(?!\w)", said, spoken,
                        flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", spoken).strip()


_STRESSIFIER = None


def stressed(text):
    """Marks Ukrainian stress with a combining acute, from the dictionary.

    Words the dictionary leaves ambiguous are left unmarked, and a word that
    already carries a mark (from pronunciation.json) is left as it is.
    """
    global _STRESSIFIER
    if _STRESSIFIER is None:
        from ukrainian_word_stress import (Disambiguation, OnAmbiguity,
                                           Stressifier, StressSymbol)
        _STRESSIFIER = Stressifier(
            stress_symbol=StressSymbol.CombiningAcuteAccent,
            on_ambiguity=OnAmbiguity.Skip,
            disambiguation=Disambiguation.Dictionary,
        )
    words = re.split(r"(\w[\w'́-]*)", text)
    out = []
    for word in words:
        if word and re.match(r"\w", word) and "́" not in word:
            out.append(_STRESSIFIER(word))
        else:
            out.append(word)
    return "".join(out)


# Whisper writes small numbers as digits; the lines spell them out.
NUMBER_WORDS = {
    "en": ["zero", "one", "two", "three", "four", "five", "six", "seven",
           "eight", "nine", "ten"],
    "uk": ["нуль", "один", "два", "три", "чотири", "п'ять", "шість", "сім",
           "вісім", "дев'ять", "десять"],
}


def comparable(text, language="en"):
    """Text reduced to letters, for comparing what was said with what was heard."""
    words = NUMBER_WORDS.get(language, NUMBER_WORDS["en"])
    text = re.sub(r"\b(10|[0-9])\b", lambda m: f" {words[int(m.group(1))]} ",
                  text)
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("'", "").replace("-", " ")
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def without_repeats(text):
    """Drops a phrase heard twice in a row: Whisper's echo on a short clip."""
    words = text.split()
    changed = True
    while changed:
        changed = False
        for size in range(len(words) // 2, 0, -1):
            for start in range(len(words) - 2 * size + 1):
                if words[start:start + size] == words[start + size:start + 2 * size]:
                    del words[start + size:start + 2 * size]
                    changed = True
                    break
            if changed:
                break
    return " ".join(words)


def character_error_rate(reference, heard, language="en"):
    """Edit distance between the two, per character of the reference."""
    a = comparable(reference, language)
    b = comparable(heard, language)
    # A repeat the line itself does not have is the judge's echo, not the voice.
    if without_repeats(a) == a:
        b = without_repeats(b)
    if not a:
        return 0.0 if not b else 1.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1,
                               previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1] / len(a)


# ─── audio ───────────────────────────────────────────────────────────────


def dbfs_to_linear(db):
    return 10 ** (db / 20)


def finish(samples, rate, np):
    """Trims the silence around the words, levels the clip, and fades its edges."""
    samples = np.asarray(samples, dtype=np.float32)
    if samples.size == 0:
        return samples
    frame = max(1, int(rate * 0.01))
    frames = samples[: samples.size // frame * frame].reshape(-1, frame)
    energy = np.sqrt((frames ** 2).mean(axis=1))
    loud = np.nonzero(energy > energy.max() * SILENCE_SHARE)[0]
    if loud.size:
        start = max(0, loud[0] * frame - int(LEAD_SECONDS * rate))
        end = min(samples.size, (loud[-1] + 1) * frame + int(TAIL_SECONDS * rate))
        samples = samples[start:end]
    active = samples[np.abs(samples) > np.abs(samples).max() * 0.05]
    rms = math.sqrt(float((active ** 2).mean())) if active.size else 0.0
    if rms > 0:
        samples = samples * (dbfs_to_linear(TARGET_RMS_DBFS) / rms)
    peak = float(np.abs(samples).max())
    ceiling = dbfs_to_linear(PEAK_CEILING_DBFS)
    if peak > ceiling:
        samples = samples * (ceiling / peak)
    fade = min(samples.size // 2, int(FADE_SECONDS * rate))
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        samples[:fade] *= ramp
        samples[-fade:] *= ramp[::-1]
    return samples.astype(np.float32)


def write_wav(path, samples, rate, np):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())


def decode_mp3(path, workdir, np):
    decoded = workdir / "decoded.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ac", "1",
                    str(decoded)], check=True)
    return read_wav(decoded, np)


def read_wav(path, np):
    with wave.open(str(path), "rb") as source:
        rate = source.getframerate()
        pcm = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
    return pcm.astype(np.float32) / 32768, rate


def shift_pitch(samples, rate, semitones, np, workdir):
    """Moves the voice by `semitones` without moving its formants or its pace."""
    if not semitones:
        return samples
    source, shifted = workdir / "pitch-in.wav", workdir / "pitch-out.wav"
    write_wav(source, samples, rate, np)
    ratio = 2 ** (semitones / 12)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(source),
         "-af", f"rubberband=pitch={ratio:.6f}:formant=preserved",
         str(shifted)], check=True)
    result, _ = read_wav(shifted, np)
    return result


def encode_mp3(samples, rate, destination, np, workdir):
    source = workdir / "encode.wav"
    write_wav(source, samples, rate, np)
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ac", "1",
         "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-map_metadata", "-1",
         "-fflags", "+bitexact", "-flags:a", "+bitexact", str(destination)],
        check=True)


# ─── models ──────────────────────────────────────────────────────────────


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_model(name, spec):
    """The model's directory, downloaded and verified on first use."""
    directory = CACHE / spec["directory"]
    if directory.is_dir():
        return directory
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / f"{name}.tar.bz2"
    if not archive.exists() or sha256_of(archive) != spec["sha256"]:
        print(f"downloading {name}", file=sys.stderr)
        urllib.request.urlretrieve(spec["url"], archive)
    actual = sha256_of(archive)
    if actual != spec["sha256"]:
        archive.unlink()
        raise SystemExit(f"{name}: SHA-256 {actual} does not match models.json")
    with tarfile.open(archive) as bundle:
        bundle.extractall(CACHE, filter="data")
    archive.unlink()
    return directory


class KokoroVoice:
    def __init__(self, directory, spec):
        import sherpa_onnx
        self.speakers = spec["speakers"]
        self.tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(directory / "model.onnx"),
                    voices=str(directory / "voices.bin"),
                    tokens=str(directory / "tokens.txt"),
                    data_dir=str(directory / "espeak-ng-data")),
                num_threads=2, provider="cpu")))

    def say(self, text, settings, take):
        # Kokoro barely varies between runs, so later takes vary the pace, and
        # only downward: hurried, it swallows a sentence's last word.
        speed = settings.get("speed", 1.0) * (1.0, 0.95, 0.9)[take % 3]
        audio = self.tts.generate(
            text, sid=self.speakers.index(settings["speaker"]), speed=speed)
        return audio.samples, audio.sample_rate


class PiperTextVoice:
    """A Piper voice trained on letters rather than phonemes.

    Its sherpa-onnx bundle declares an espeak front end the model was never
    trained on, so the network is run directly, the way Piper itself feeds a
    `phoneme_type: text` voice: decomposed lowercase characters, each followed
    by padding, after the begin symbol and its own padding, then the end
    symbol.
    """

    def __init__(self, directory, spec):
        import onnxruntime
        self.config = json.loads(
            (directory / f"{spec['onnx']}.json").read_text(encoding="utf-8"))
        self.ids = self.config["phoneme_id_map"]
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 2
        self.session = onnxruntime.InferenceSession(
            str(directory / spec["onnx"]), options,
            providers=["CPUExecutionProvider"])
        self.rate = self.config["audio"]["sample_rate"]

    def tokens(self, text):
        # piper-phonemize pads after the begin symbol too; without it the
        # voice swallows a line's first sound.
        ids = list(self.ids["^"]) + self.ids["_"]
        for char in unicodedata.normalize("NFD", text.lower()):
            if char in self.ids:
                ids += self.ids[char] + self.ids["_"]
        return ids + self.ids["$"]

    def say(self, text, settings, take):
        import numpy as np
        ids = np.array([self.tokens(text)], dtype=np.int64)
        scales = np.array([settings.get("noise", 0.667),
                           settings.get("length", 1.0),
                           settings.get("noiseW", 0.8)], dtype=np.float32)
        speaker = self.config["speaker_id_map"][settings["speaker"]]
        audio = self.session.run(None, {
            "input": ids,
            "input_lengths": np.array([ids.shape[1]], dtype=np.int64),
            "scales": scales,
            "sid": np.array([speaker], dtype=np.int64),
        })[0]
        return audio.squeeze(), self.rate


class WhisperJudge:
    def __init__(self, directory):
        import sherpa_onnx
        self.directory = directory
        self.sherpa = sherpa_onnx
        self.recognizers = {}

    def judge(self, samples, rate, language, said):
        """What was heard, and how far it is from what was said.

        Whisper misjudges short clips two opposite ways: one that ends right
        on its last word is often cut short, and the same clip with silence
        after it is sometimes heard twice over. It listens both ways, and the
        closer reading counts.
        """
        import numpy as np
        samples = np.asarray(samples, dtype=np.float32)
        padded = np.concatenate([
            np.zeros(int(rate * JUDGE_LEAD_SECONDS), dtype=np.float32),
            samples,
            np.zeros(int(rate * JUDGE_TAIL_SECONDS), dtype=np.float32)])
        readings = [self.hear(take, rate, language) for take in (samples, padded)]
        scored = [(character_error_rate(said, heard, language), heard)
                  for heard in readings]
        return min(scored)

    def hear(self, samples, rate, language):
        if language not in self.recognizers:
            self.recognizers[language] = (
                self.sherpa.OfflineRecognizer.from_whisper(
                    encoder=str(self.directory / "turbo-encoder.int8.onnx"),
                    decoder=str(self.directory / "turbo-decoder.int8.onnx"),
                    tokens=str(self.directory / "turbo-tokens.txt"),
                    language=language, task="transcribe", num_threads=4))
        recognizer = self.recognizers[language]
        stream = recognizer.create_stream()
        stream.accept_waveform(rate, samples)
        recognizer.decode_stream(stream)
        return stream.result.text.strip()


# ─── lines ───────────────────────────────────────────────────────────────


def export_lines():
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings",
         str(HERE / "export-lines.mjs")],
        check=True, capture_output=True, text=True, cwd=ROOT)
    return json.loads(result.stdout)


def clip_key(line):
    if line["character"] == "xsasha":
        return f"{line['locale']}/xsasha-{line['voice']}/{line['key']}"
    return f"{line['locale']}/{line['study']}/{line['kind']}.{line['index']}"


def voice_settings(locale, line):
    """How this line's character speaks: an Avaia by its study, xSasha by
    the gender of the study she is drawn in."""
    if line["character"] == "xsasha":
        return locale["xsasha"][line["voice"]]
    return locale["studies"][line["study"]]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", action="append", default=[],
                        help="locale/study/kind.index; repeatable")
    parser.add_argument("--takes", type=int, help="takes per line")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the spoken text and render nothing")
    parser.add_argument("--rejudge", action="store_true",
                        help="listen to the clips already rendered again and "
                             "update what the manifest says was heard")
    parser.add_argument("--retry-above", type=float, metavar="CER",
                        help="render again only the lines the manifest says "
                             "were heard worse than this")
    args = parser.parse_args()

    voices = load_json("voices.json")
    models = load_json("models.json")
    pronunciation = load_json("pronunciation.json")
    # A line whose text carries a name the moment fills in (a Bond's address,
    # an Avaia's) is said in a wording without it: the card shows the name,
    # the voice does not spell out an address.
    spoken_overrides = load_json("spoken.json")
    output = ROOT / "deploy" / "web" / "voices" / voices["version"]
    manifest_path = output / "manifest.json"
    manifest = (json.loads(manifest_path.read_text(encoding="utf-8"))
                if manifest_path.exists() else {"lines": {}})

    lines = export_lines()
    if args.only:
        lines = [line for line in lines if clip_key(line) in args.only]
    if args.retry_above is not None:
        lines = [line for line in lines
                 if manifest["lines"].get(clip_key(line), {}).get(
                     "characterErrorRate", 1.0) > args.retry_above]
    for line in lines:
        written = spoken_overrides.get(line["locale"], {}).get(
            line.get("key", ""), line["text"])
        if "{" in written:
            raise SystemExit(f"{clip_key(line)}: a name placeholder needs a "
                             "spoken wording in spoken.json")
        spoken = spoken_text(written, line["locale"], pronunciation)
        if line["locale"] == "uk-UA":
            spoken = stressed(spoken)
        line["spoken"] = spoken
    if args.dry_run:
        for line in lines:
            print(f"{clip_key(line)}\t{line['spoken']}")
        return

    import numpy as np
    takes = args.takes or voices["takes"]
    engines = {"kokoro": KokoroVoice, "piper-text": PiperTextVoice}
    loaded = {}
    judge = WhisperJudge(fetch_model("sherpa-onnx-whisper-turbo",
                                     models["sherpa-onnx-whisper-turbo"]))

    with tempfile.TemporaryDirectory() as scratch:
        workdir = Path(scratch)
        if args.rejudge:
            for number, line in enumerate(lines, 1):
                key = clip_key(line)
                entry = manifest["lines"].get(key)
                clip = output / f"{key}.mp3"
                if entry is None or not clip.exists():
                    continue
                judged = voices["locales"][line["locale"]]["judge"]
                samples, rate = decode_mp3(clip, workdir, np)
                error, entry["heard"] = judge.judge(samples, rate, judged,
                                                    entry["spoken"])
                entry["characterErrorRate"] = round(error, 3)
                print(f"[{number}/{len(lines)}] {key} "
                      f"cer={entry['characterErrorRate']:.2f} "
                      f"heard={entry['heard']!r}", flush=True)
            write_manifest(manifest_path, manifest, voices, models)
            return
        for number, line in enumerate(lines, 1):
            locale = voices["locales"][line["locale"]]
            settings = voice_settings(locale, line)
            model_name = locale["model"]
            if model_name not in loaded:
                spec = models[model_name]
                loaded[model_name] = engines[spec["engine"]](
                    fetch_model(model_name, spec), spec)
            voice = loaded[model_name]

            best = None
            for take in range(takes):
                samples, rate = voice.say(line["spoken"], settings, take)
                samples = shift_pitch(finish(samples, rate, np), rate,
                                      settings.get("pitch", 0), np, workdir)
                error, heard = judge.judge(samples, rate, locale["judge"],
                                           line["spoken"])
                if best is None or error < best["error"]:
                    best = {"samples": samples, "rate": rate, "heard": heard,
                            "error": error, "take": take}
                if error == 0:
                    break

            key = clip_key(line)
            destination = output / f"{key}.mp3"
            encode_mp3(best["samples"], best["rate"], destination, np, workdir)
            manifest["lines"][key] = {
                "text": line["text"],
                "spoken": line["spoken"],
                "heard": best["heard"],
                "characterErrorRate": round(best["error"], 3),
                "seconds": round(len(best["samples"]) / best["rate"], 2),
                "sha256": sha256_of(destination),
            }
            print(f"[{number}/{len(lines)}] {key} cer={best['error']:.2f} "
                  f"take={best['take']} heard={best['heard']!r}", flush=True)
            # Written after every line, so an interrupted render keeps its work.
            write_manifest(manifest_path, manifest, voices, models)

    write_manifest(manifest_path, manifest, voices, models)


def write_manifest(path, manifest, voices, models):
    manifest["version"] = voices["version"]
    manifest["voices"] = {
        locale: {
            **{study: {"model": spec["model"], **settings}
               for study, settings in spec["studies"].items()},
            **{f"xsasha-{gender}": {"model": spec["model"], **settings}
               for gender, settings in spec.get("xsasha", {}).items()},
        }
        for locale, spec in voices["locales"].items()}
    manifest["unvoiced"] = voices["unvoiced"]
    manifest["models"] = {
        name: {"license": spec["license"], "credit": spec["credit"],
               "sha256": spec["sha256"]}
        for name, spec in models.items()}
    manifest["lines"] = dict(sorted(manifest["lines"].items()))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


if __name__ == "__main__":
    main()
