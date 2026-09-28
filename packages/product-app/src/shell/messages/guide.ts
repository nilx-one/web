// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What xSasha says, and what a person may say back. A line with several
 * numbered keys is one line in several wordings: the scene picks a different
 * one each time it plays, and every wording means the same thing.
 */
export const GUIDE_EN = {
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Continue",
  "guide.intro.greeting.0":
    "Hi, bunny. The two of us are going to have fun — but I’m busy right now. Go create your Avaia.",
  "guide.intro.greeting.1":
    "Hey, bunny. It’ll be fun with the two of us, I promise. Only I’m tied up right now — create your Avaia first.",
  "guide.intro.greeting.2":
    "There you are, bunny. We’ll have a good time, you and me. But I’m busy for now — make yourself an Avaia.",
  "guide.intro.howTo.0":
    "Then you already know the way. Down in the Dock sits your Avaia, {avaia}, still unconfigured. Tap it and press Create — it already knows its name.",
  "guide.intro.howTo.1":
    "Then this will feel familiar. Your Avaia, {avaia}, is waiting in the Dock below. Tap its card, then Create. The name is already its own.",
  "guide.intro.farewell.0": "Fine. I’ll drop by again.",
  "guide.intro.farewell.1": "Okay. I’ll be around.",
  "guide.reward.grow.0": "Look at you. Growing.",
  "guide.reward.grow.1": "There. You’re growing, bunny.",
  "guide.reward.grow.2": "See? You’re growing.",
  "guide.reward.together.0": "And now it’s the two of you. I’ll be near.",
  "guide.reward.together.1": "Now go — you and {avaia}. I’ll find you.",
  "guide.choice.curious.0":
    "This is strange. I feel like I’ve been here before.",
  "guide.choice.curious.1": "Strange… as if I’ve already been here.",
  "guide.choice.curious.2": "Odd. All of this feels familiar.",
  "guide.choice.later.0": "Later.",
  "guide.choice.later.1": "Not now.",
  "guide.choice.later.2": "Some other time.",
  "guide.choice.go.0": "I’ll do it now.",
  "guide.choice.go.1": "On my way.",
  "guide.choice.thanks.0": "Thank you.",
  "guide.choice.thanks.1": "That’s nice to hear.",
  "guide.choice.thanks.2": "That was easy.",
  "guide.choice.skip": "(skip)",
  "guide.choice.continue": "(continue)",
} as const;

export const GUIDE_UK: Readonly<Record<keyof typeof GUIDE_EN, string>> = {
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Далі",
  "guide.intro.greeting.0":
    "Привіт, зайчик. Нам удвох буде прікольно, проте наразі я зайнята — створи свою Avaia.",
  "guide.intro.greeting.1":
    "О, зайчик, привіт. Нам з тобою буде прікольно, обіцяю. Але зараз я зайнята — спершу створи свою Avaia.",
  "guide.intro.greeting.2":
    "Ось і ти, зайчик. Удвох нам буде прікольно. Тільки поки я зайнята — створи собі Avaia.",
  "guide.intro.howTo.0":
    "Тоді ти знаєш дорогу. Внизу, у Dock, чекає твоя Avaia — {avaia}, поки unconfigured. Торкнись її й натисни «Створити». Ім’я вона вже знає.",
  "guide.intro.howTo.1":
    "Тоді тобі це знайоме. Твоя Avaia, {avaia}, — внизу, у Dock. Торкнись картки, потім «Створити». Своє ім’я вона вже має.",
  "guide.intro.farewell.0": "Добре. Я ще зазирну.",
  "guide.intro.farewell.1": "Гаразд. Я буду поруч.",
  "guide.reward.grow.0": "Ростеш.",
  "guide.reward.grow.1": "Ну от. Ростеш, зайчик.",
  "guide.reward.grow.2": "Бачиш? Ростеш.",
  "guide.reward.together.0": "А тепер — ви удвох. Я поруч.",
  "guide.reward.together.1": "Тепер ідіть — ти і {avaia}. Я вас знайду.",
  "guide.choice.curious.0": "Це дивно. Я відчуваю, що вже був тут.",
  "guide.choice.curious.1": "Дивно… ніби я вже тут колись був.",
  "guide.choice.curious.2": "Дивне відчуття. Усе це вже було.",
  "guide.choice.later.0": "Пізніше.",
  "guide.choice.later.1": "Не зараз.",
  "guide.choice.later.2": "Згодом.",
  "guide.choice.go.0": "Зараз зроблю.",
  "guide.choice.go.1": "Уже йду.",
  "guide.choice.thanks.0": "Дякую.",
  "guide.choice.thanks.1": "Приємно чути.",
  "guide.choice.thanks.2": "Це було легко.",
  "guide.choice.skip": "(пропустити)",
  "guide.choice.continue": "(далі)",
};

export const GUIDE_RU: Readonly<Record<keyof typeof GUIDE_EN, string>> = {
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Далее",
  "guide.intro.greeting.0":
    "Привет, зайчик. Нам вдвоём будет прикольно, но сейчас я занята — создай свою Avaia.",
  "guide.intro.greeting.1":
    "О, зайчик, привет. Нам с тобой будет прикольно, обещаю. Но сейчас я занята — сначала создай свою Avaia.",
  "guide.intro.greeting.2":
    "Вот и ты, зайчик. Вдвоём нам будет прикольно. Только пока я занята — создай себе Avaia.",
  "guide.intro.howTo.0":
    "Тогда ты знаешь дорогу. Внизу, в Dock, ждёт твоя Avaia — {avaia}, пока unconfigured. Коснись её и нажми «Создать». Имя она уже знает.",
  "guide.intro.howTo.1":
    "Тогда тебе это знакомо. Твоя Avaia, {avaia}, — внизу, в Dock. Коснись карточки, потом «Создать». Своё имя у неё уже есть.",
  "guide.intro.farewell.0": "Хорошо. Я ещё загляну.",
  "guide.intro.farewell.1": "Ладно. Я буду рядом.",
  "guide.reward.grow.0": "Растёшь.",
  "guide.reward.grow.1": "Ну вот. Растёшь, зайчик.",
  "guide.reward.grow.2": "Видишь? Растёшь.",
  "guide.reward.together.0": "А теперь — вы вдвоём. Я рядом.",
  "guide.reward.together.1": "Теперь идите — ты и {avaia}. Я вас найду.",
  "guide.choice.curious.0": "Это странно. Я чувствую, что уже был здесь.",
  "guide.choice.curious.1": "Странно… будто я уже здесь когда-то был.",
  "guide.choice.curious.2": "Странное чувство. Всё это уже было.",
  "guide.choice.later.0": "Позже.",
  "guide.choice.later.1": "Не сейчас.",
  "guide.choice.later.2": "Потом.",
  "guide.choice.go.0": "Сейчас сделаю.",
  "guide.choice.go.1": "Уже иду.",
  "guide.choice.thanks.0": "Спасибо.",
  "guide.choice.thanks.1": "Приятно слышать.",
  "guide.choice.thanks.2": "Это было легко.",
  "guide.choice.skip": "(пропустить)",
  "guide.choice.continue": "(далее)",
};
