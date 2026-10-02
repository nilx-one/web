# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Checks on what the voices are asked to say and how a take is judged.

They need no model: run them with `python tools/voices/test_text.py`.
"""
import json
import unittest
from pathlib import Path

import numpy as np

import render

HERE = Path(__file__).resolve().parent
PRONUNCIATION = json.loads((HERE / "pronunciation.json").read_text("utf-8"))


class SpokenText(unittest.TestCase):
    def test_typography_a_voice_cannot_say_is_dropped(self):
        self.assertEqual(
            render.spoken_text("Relocating one (1) Avaia.", "en", {}),
            "Relocating one Avaia.")
        self.assertEqual(render.spoken_text("Going, going…", "en", {}),
                         "Going, going.")
        self.assertEqual(
            render.spoken_text("Мої черевики кажуть «ні».", "uk-UA", {}),
            "Мої черевики кажуть ні.")

    def test_words_are_respelled_whole_and_in_any_case(self):
        said = render.spoken_text("Іду-іду…", "uk-UA", PRONUNCIATION)
        self.assertEqual(said, "іду́-іду́.")
        # "образ" is respelled; "образливо" is a different word and is not.
        self.assertEqual(
            render.spoken_text("образ, образливо", "uk-UA", PRONUNCIATION),
            "о́браз, образливо")

    def test_every_respelling_carries_a_stress_mark_or_is_a_name(self):
        for written, said in PRONUNCIATION["uk-UA"].items():
            with self.subTest(written=written):
                self.assertIn("́", said)


class Judging(unittest.TestCase):
    def test_what_was_heard_is_compared_by_letters_alone(self):
        self.assertEqual(render.character_error_rate(
            "Та чому́ б і ні. Іду́.", "та чому б і ні, іду"), 0.0)
        self.assertEqual(render.character_error_rate(
            "Fog of war. Classic.", "Fog of War Classic"), 0.0)

    def test_numbers_heard_as_digits_count_as_said(self):
        self.assertEqual(render.character_error_rate(
            "Я вже роблю́ три!", "Я вже роблю 3!", "uk"), 0.0)
        self.assertEqual(render.character_error_rate(
            "Three at once is my limit.", "3 at once is my limit."), 0.0)

    def test_an_echo_of_a_short_line_is_the_judge_not_the_voice(self):
        self.assertEqual(render.character_error_rate(
            "Door not found.", "Door not found. Door not found"), 0.0)
        # A line that repeats itself keeps its repeat.
        self.assertEqual(render.character_error_rate(
            "Going, going.", "Going, going."), 0.0)
        self.assertGreater(render.character_error_rate(
            "Going, going.", "Going."), 0.3)

    def test_a_missing_word_costs_its_letters(self):
        error = render.character_error_rate(
            "I don't go where you haven't been.",
            "I don't go where you haven't")
        self.assertGreater(error, 0.1)


class Finishing(unittest.TestCase):
    def test_a_soft_ending_survives_the_trim(self):
        rate = 22050
        t = np.arange(int(rate * 0.6)) / rate
        word = np.sin(2 * np.pi * 220 * t) * 0.5
        # A tail at -40 dB below the word, the way a final consonant fades.
        tail = np.sin(2 * np.pi * 220 * t[: rate // 5]) * 0.005
        silence = np.zeros(rate // 2)
        clip = np.concatenate([silence, word, tail, silence]).astype(np.float32)
        finished = render.finish(clip, rate, np)
        self.assertGreaterEqual(len(finished),
                                len(word) + len(tail) - rate * 0.02)
        self.assertLess(len(finished), len(clip))

    def test_every_clip_is_brought_to_the_same_loudness(self):
        rate = 22050
        t = np.arange(rate) / rate
        quiet = render.finish(np.sin(2 * np.pi * 300 * t) * 0.05, rate, np)
        loud = render.finish(np.sin(2 * np.pi * 300 * t) * 0.8, rate, np)
        rms = lambda x: float(np.sqrt((x[rate // 10:-rate // 10] ** 2).mean()))
        self.assertAlmostEqual(rms(quiet), rms(loud), places=3)
        self.assertLessEqual(np.abs(loud).max(),
                             render.dbfs_to_linear(render.PEAK_CEILING_DBFS))


if __name__ == "__main__":
    unittest.main()
