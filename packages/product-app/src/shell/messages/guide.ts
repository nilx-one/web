// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What xSasha says, and what a person may say back. A line with several
 * numbered keys is one line in several wordings: the scene picks a different
 * one each time it plays, and every wording means the same thing.
 *
 * She mirrors the Bond, so a wording the language marks for gender is written
 * once per voice — `.feminine`, `.masculine`, `.neutral` — and she and the
 * Bond's replies are said in the voice of the study the Bond wears. English
 * marks none of these; it carries every voice so the three catalogues agree.
 */
export const GUIDE_EN = {
  "system.ping.error": "Something went wrong",
  "system.ping.name": "xPing",
  "system.ping.asideLabel": "Muttering to himself",
  "system.ping.aside.module":
    "A new module, I said. They warmed up the old one. Now it has memories.",
  "system.ping.aside.tape":
    "Weld the hull, I said. They used tape. Reinforced tape. Luxury.",
  "system.ping.aside.screw":
    "Three screws left. There were four this morning. Hm. Weight optimisation.",
  "system.ping.aside.rotor":
    "Left rotor, we discussed this. Squeak on your own time.",
  "system.ping.aside.warranty":
    "Warranty expired before I left the workbench. Efficient.",
  "system.ping.aside.paint":
    "A replacement panel in the wrong colour. Apparently I am a limited edition.",
  "system.ping.aside.manual":
    "The manual says: do not hit. The manual has never lived in this hull.",
  "system.ping.aside.smoke":
    "That is not smoke. That is my cooling budget leaving.",

  "system.ping.role": "System informer",
  "system.ping.skip": "(skip)",
  "system.ping.done": "Understood",
  "system.ping.window": "Service window",
  "guide.result.title": "Scene complete",
  "guide.result.territory":
    "Opening a cell takes time. Orbs on opened ground give you or your Avaia experience.",
  "guide.result.create":
    "Choose a 3D model, check the name, then save your Avaia.",
  "guide.result.later":
    "Introduction postponed. You can create your Avaia from the Dock.",
  "guide.result.skipped":
    "Introduction skipped. You can create your Avaia from the Dock.",
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Continue",
  "guide.intro.greeting.0.feminine":
    "Hi, bunny. The two of us are going to have fun — but I’m busy right now. Go create your Avaia.",
  "guide.intro.greeting.0.masculine":
    "Hi, bunny. The two of us are going to have fun — but I’m busy right now. Go create your Avaia.",
  "guide.intro.greeting.0.neutral":
    "Hi, bunny. The two of us are going to have fun — but I’m busy right now. Go create your Avaia.",
  "guide.intro.greeting.1.feminine":
    "Hey, bunny. It’ll be fun with the two of us, I promise. Only I’m tied up right now — create your Avaia first.",
  "guide.intro.greeting.1.masculine":
    "Hey, bunny. It’ll be fun with the two of us, I promise. Only I’m tied up right now — create your Avaia first.",
  "guide.intro.greeting.1.neutral":
    "Hey, bunny. It’ll be fun with the two of us, I promise. Only I’m tied up right now — create your Avaia first.",
  "guide.intro.greeting.2.feminine":
    "There you are, bunny. We’ll have a good time, you and me. But I’m busy for now — make yourself an Avaia.",
  "guide.intro.greeting.2.masculine":
    "There you are, bunny. We’ll have a good time, you and me. But I’m busy for now — make yourself an Avaia.",
  "guide.intro.greeting.2.neutral":
    "There you are, bunny. We’ll have a good time, you and me. But I’m busy for now — make yourself an Avaia.",
  "guide.intro.howTo.0":
    "Then you already know the way. Down in the Dock sits your Avaia, {avaia}, still unconfigured. Tap it and press Create — it already knows its name.",
  "guide.intro.howTo.1":
    "Then this will feel familiar. Your Avaia, {avaia}, is waiting in the Dock below. Tap its card, then Create. The name is already its own.",
  "guide.intro.farewell.0": "Fine. I’ll drop by again.",
  "guide.intro.farewell.1": "Okay. I’ll be around.",
  "guide.reward.almostForgot.0.feminine": "Almost forgot — here, {bond}.",
  "guide.reward.almostForgot.0.masculine": "Almost forgot — here, {bond}.",
  "guide.reward.almostForgot.0.neutral": "Almost forgot — here, {bond}.",
  "guide.reward.almostForgot.1.feminine":
    "Oh, I nearly left without giving you this. Here, {bond}.",
  "guide.reward.almostForgot.1.masculine":
    "Oh, I nearly left without giving you this. Here, {bond}.",
  "guide.reward.almostForgot.1.neutral":
    "Oh, I nearly left without giving you this. Here, {bond}.",
  "guide.reward.almostForgot.2": "Wait. This is yours, {bond}.",
  "guide.reward.together.0": "And now it’s the two of you. I’ll be near.",
  "guide.backpack.gift.0":
    "Pockets full already? Here — a backpack for you, and one for your Avaia.",
  "guide.backpack.gift.1":
    "You’ll need more than pockets out there. A backpack each, for you and your Avaia.",
  "guide.backpack.gift.2":
    "Take these. Two backpacks: yours, and your Avaia’s.",
  "guide.backpack.title": "Backpacks",
  "guide.backpack.item": "Backpack · 40 cells",
  "guide.territory.newGround.0":
    "There — new ground. Every cell takes its time to open: the timer over it counts down, longer where more lies hidden. And look — orbs spilled out of it. Every one you pick up makes you or {avaia} more experienced.",
  "guide.territory.newGround.1":
    "Fog doesn’t lift at once: each cell has its own timer, and the more it hides, the longer it runs. What it hides spills out as orbs — pick them up, and you or {avaia} grow more experienced with each one.",
  "guide.territory.newGround.2":
    "You’ve opened your first cell. The timer over a cell shows how long it still needs. Once it’s open, collect the orbs on it — each makes you or {avaia} more experienced.",
  "guide.reward.together.1": "Now go — you and {avaia}. I’ll find you.",
  "guide.choice.curious.0.feminine":
    "This is strange. I feel like I’ve been here before.",
  "guide.choice.curious.0.masculine":
    "This is strange. I feel like I’ve been here before.",
  "guide.choice.curious.0.neutral":
    "This is strange. I feel like I’ve been here before.",
  "guide.choice.curious.1.feminine": "Strange… as if I’ve already been here.",
  "guide.choice.curious.1.masculine": "Strange… as if I’ve already been here.",
  "guide.choice.curious.1.neutral": "Strange… as if I’ve already been here.",
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
  "system.ping.error": "Виникла помилка",
  "system.ping.name": "xPing",
  "system.ping.asideLabel": "Бурмоче сам до себе",
  "system.ping.aside.module":
    "Модуль просив замінити. Прогріли старий. Тепер він ще й зі спогадами.",
  "system.ping.aside.tape":
    "Корпус просив заварити. Заклеїли. Зате скотч армований. Розкіш.",
  "system.ping.aside.screw":
    "Три гвинти лишилось. Зранку було чотири. Хм. Оптимізація ваги.",
  "system.ping.aside.rotor":
    "Лівий роторе, ми ж домовлялись. Скрипіти у вільний від роботи час.",
  "system.ping.aside.warranty":
    "Гарантія скінчилась, поки лежав на верстаку. Оперативно.",
  "system.ping.aside.paint":
    "Панель іншого кольору. Тепер я, виявляється, лімітована серія.",
  "system.ping.aside.manual":
    "В інструкції пишуть: не стукати. Інструкція в цьому корпусі не жила.",
  "system.ping.aside.smoke":
    "Це не дим. Це бюджет на охолодження випаровується.",

  "system.ping.role": "Системний інформатор",
  "system.ping.skip": "(пропустити)",
  "system.ping.done": "Зрозуміло",
  "system.ping.window": "Час робіт",
  "guide.result.title": "Катсцену завершено",
  "guide.result.territory":
    "Клітинка відкривається за таймером. Кульки на відкритій території дають досвід вам або вашій Avaia.",
  "guide.result.create":
    "Оберіть 3D model, перевірте ім’я та збережіть свою Avaia.",
  "guide.result.later":
    "Знайомство відкладено. Створити Avaia можна через Dock.",
  "guide.result.skipped":
    "Знайомство пропущено. Створити Avaia можна через Dock.",
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Далі",
  "guide.intro.greeting.0.feminine":
    "Привіт, зайчик. Нам удвох буде прікольно, проте наразі я зайнята — створи свою Avaia.",
  "guide.intro.greeting.0.masculine":
    "Привіт, зайчик. Нам удвох буде прікольно, проте наразі я зайнятий — створи свою Avaia.",
  "guide.intro.greeting.0.neutral":
    "Привіт, зайчик. Нам удвох буде прікольно, проте наразі в мене справи — створи свою Avaia.",
  "guide.intro.greeting.1.feminine":
    "О, зайчик, привіт. Нам з тобою буде прікольно, обіцяю. Але зараз я зайнята — спершу створи свою Avaia.",
  "guide.intro.greeting.1.masculine":
    "О, зайчик, привіт. Нам з тобою буде прікольно, обіцяю. Але зараз я зайнятий — спершу створи свою Avaia.",
  "guide.intro.greeting.1.neutral":
    "О, зайчик, привіт. Нам з тобою буде прікольно, обіцяю. Але зараз у мене купа справ — спершу створи свою Avaia.",
  "guide.intro.greeting.2.feminine":
    "Ось і ти, зайчик. Удвох нам буде прікольно. Тільки поки я зайнята — створи собі Avaia.",
  "guide.intro.greeting.2.masculine":
    "Ось і ти, зайчик. Удвох нам буде прікольно. Тільки поки я зайнятий — створи собі Avaia.",
  "guide.intro.greeting.2.neutral":
    "Ось і ти, зайчик. Удвох нам буде прікольно. Тільки поки мені ніколи — створи собі Avaia.",
  "guide.intro.howTo.0":
    "Тоді ти знаєш дорогу. Внизу, у Dock, чекає твоя Avaia — {avaia}, поки unconfigured. Торкнись її й натисни «Створити». Ім’я вона вже знає.",
  "guide.intro.howTo.1":
    "Тоді тобі це знайоме. Твоя Avaia, {avaia}, — внизу, у Dock. Торкнись картки, потім «Створити». Своє ім’я вона вже має.",
  "guide.intro.farewell.0": "Добре. Я ще зазирну.",
  "guide.intro.farewell.1": "Гаразд. Я буду поруч.",
  "guide.reward.almostForgot.0.feminine": "Ледь не забула — тримай, {bond}.",
  "guide.reward.almostForgot.0.masculine": "Ледь не забув — тримай, {bond}.",
  "guide.reward.almostForgot.0.neutral":
    "Ледь не вилетіло з голови — тримай, {bond}.",
  "guide.reward.almostForgot.1.feminine":
    "Ой, мало не пішла просто так. Тримай, {bond}.",
  "guide.reward.almostForgot.1.masculine":
    "Ой, мало не пішов просто так. Тримай, {bond}.",
  "guide.reward.almostForgot.1.neutral":
    "Ой, ще дещо наостанок. Тримай, {bond}.",
  "guide.reward.almostForgot.2": "Стій. Це твоє, {bond}.",
  "guide.reward.together.0": "А тепер — ви удвох. Я поруч.",
  "guide.backpack.gift.0":
    "Кишені вже повні? Тримай — рюкзак тобі й один для твоєї Avaia.",
  "guide.backpack.gift.1":
    "Самих кишень там не вистачить. По рюкзаку — тобі й твоїй Avaia.",
  "guide.backpack.gift.2": "Бери. Два рюкзаки: твій і твоєї Avaia.",
  "guide.backpack.title": "Рюкзаки",
  "guide.backpack.item": "Рюкзак · 40 клітинок",
  "guide.territory.newGround.0":
    "Ось і нова територія. Кожна клітинка відкривається не одразу: таймер над нею показує, скільки ще чекати, — довше там, де більше сховано. А глянь — з неї висипались кульки. За кожну зібрану ти або {avaia} станете досвідченішими.",
  "guide.territory.newGround.1":
    "Туман не розходиться миттю: у кожної клітинки свій таймер, і що більше вона ховає, то довше він іде. А сховане висипається кульками — збирай, і з кожною ти або {avaia} станете досвідченішими.",
  "guide.territory.newGround.2":
    "Перша клітинка — твоя. Таймер над клітинкою показує, скільки їй ще відкриватись. А на відкритій землі збирай кульки: за кожну ти або {avaia} станете досвідченішими.",
  "guide.reward.together.1": "Тепер ідіть — ти і {avaia}. Я вас знайду.",
  "guide.choice.curious.0.feminine": "Це дивно. Я відчуваю, що вже була тут.",
  "guide.choice.curious.0.masculine": "Це дивно. Я відчуваю, що вже був тут.",
  "guide.choice.curious.0.neutral":
    "Це дивно. Таке відчуття, ніби тут уже доводилось бувати.",
  "guide.choice.curious.1.feminine": "Дивно… ніби я вже тут колись була.",
  "guide.choice.curious.1.masculine": "Дивно… ніби я вже тут колись був.",
  "guide.choice.curious.1.neutral": "Дивно… ніби все це вже колись було.",
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
  "system.ping.error": "Произошла ошибка",
  "system.ping.name": "xPing",
  "system.ping.asideLabel": "Бормочет себе под нос",
  "system.ping.aside.module":
    "Модуль просил заменить. Прогрели старый. Теперь он ещё и с воспоминаниями.",
  "system.ping.aside.tape":
    "Корпус просил заварить. Заклеили. Зато скотч армированный. Роскошь.",
  "system.ping.aside.screw":
    "Три винта осталось. Утром было четыре. Хм. Оптимизация веса.",
  "system.ping.aside.rotor":
    "Левый ротор, мы же договаривались. Скрипеть в свободное от работы время.",
  "system.ping.aside.warranty":
    "Гарантия кончилась, пока лежал на верстаке. Оперативно.",
  "system.ping.aside.paint":
    "Панель другого цвета. Теперь я, оказывается, лимитированная серия.",
  "system.ping.aside.manual":
    "В инструкции пишут: не стучать. Инструкция в этом корпусе не жила.",
  "system.ping.aside.smoke": "Это не дым. Это бюджет на охлаждение испаряется.",

  "system.ping.role": "Системный информатор",
  "system.ping.skip": "(пропустить)",
  "system.ping.done": "Понятно",
  "system.ping.window": "Время работ",
  "guide.result.title": "Катсцена завершена",
  "guide.result.territory":
    "Клетка открывается по таймеру. Шарики на открытой территории дают опыт вам или вашей Avaia.",
  "guide.result.create":
    "Выберите 3D model, проверьте имя и сохраните свою Avaia.",
  "guide.result.later": "Знакомство отложено. Создать Avaia можно через Dock.",
  "guide.result.skipped":
    "Знакомство пропущено. Создать Avaia можно через Dock.",
  "guide.speaker": "xSasha",
  "guide.cutscene.advance": "Далее",
  "guide.intro.greeting.0.feminine":
    "Привет, зайчик. Нам вдвоём будет прикольно, но сейчас я занята — создай свою Avaia.",
  "guide.intro.greeting.0.masculine":
    "Привет, зайчик. Нам вдвоём будет прикольно, но сейчас я занят — создай свою Avaia.",
  "guide.intro.greeting.0.neutral":
    "Привет, зайчик. Нам вдвоём будет прикольно, но сейчас у меня дела — создай свою Avaia.",
  "guide.intro.greeting.1.feminine":
    "О, зайчик, привет. Нам с тобой будет прикольно, обещаю. Но сейчас я занята — сначала создай свою Avaia.",
  "guide.intro.greeting.1.masculine":
    "О, зайчик, привет. Нам с тобой будет прикольно, обещаю. Но сейчас я занят — сначала создай свою Avaia.",
  "guide.intro.greeting.1.neutral":
    "О, зайчик, привет. Нам с тобой будет прикольно, обещаю. Но сейчас у меня куча дел — сначала создай свою Avaia.",
  "guide.intro.greeting.2.feminine":
    "Вот и ты, зайчик. Вдвоём нам будет прикольно. Только пока я занята — создай себе Avaia.",
  "guide.intro.greeting.2.masculine":
    "Вот и ты, зайчик. Вдвоём нам будет прикольно. Только пока я занят — создай себе Avaia.",
  "guide.intro.greeting.2.neutral":
    "Вот и ты, зайчик. Вдвоём нам будет прикольно. Только пока мне некогда — создай себе Avaia.",
  "guide.intro.howTo.0":
    "Тогда ты знаешь дорогу. Внизу, в Dock, ждёт твоя Avaia — {avaia}, пока unconfigured. Коснись её и нажми «Создать». Имя она уже знает.",
  "guide.intro.howTo.1":
    "Тогда тебе это знакомо. Твоя Avaia, {avaia}, — внизу, в Dock. Коснись карточки, потом «Создать». Своё имя у неё уже есть.",
  "guide.intro.farewell.0": "Хорошо. Я ещё загляну.",
  "guide.intro.farewell.1": "Ладно. Я буду рядом.",
  "guide.reward.almostForgot.0.feminine": "Чуть не забыла — держи, {bond}.",
  "guide.reward.almostForgot.0.masculine": "Чуть не забыл — держи, {bond}.",
  "guide.reward.almostForgot.0.neutral":
    "Чуть не вылетело из головы — держи, {bond}.",
  "guide.reward.almostForgot.1.feminine":
    "Ой, чуть не ушла просто так. Держи, {bond}.",
  "guide.reward.almostForgot.1.masculine":
    "Ой, чуть не ушёл просто так. Держи, {bond}.",
  "guide.reward.almostForgot.1.neutral":
    "Ой, ещё кое-что напоследок. Держи, {bond}.",
  "guide.reward.almostForgot.2": "Стой. Это твоё, {bond}.",
  "guide.reward.together.0": "А теперь — вы вдвоём. Я рядом.",
  "guide.backpack.gift.0":
    "Карманы уже полны? Держи — рюкзак тебе и один для твоей Avaia.",
  "guide.backpack.gift.1":
    "Одних карманов там не хватит. По рюкзаку — тебе и твоей Avaia.",
  "guide.backpack.gift.2": "Бери. Два рюкзака: твой и твоей Avaia.",
  "guide.backpack.title": "Рюкзаки",
  "guide.backpack.item": "Рюкзак · 40 клеток",
  "guide.territory.newGround.0":
    "Вот и новая территория. Каждая клетка открывается не сразу: таймер над ней показывает, сколько ещё ждать, — дольше там, где больше спрятано. А смотри — из неё высыпались шарики. За каждый собранный ты или {avaia} станете опытнее.",
  "guide.territory.newGround.1":
    "Туман не расходится мгновенно: у каждой клетки свой таймер, и чем больше она прячет, тем дольше он идёт. А спрятанное высыпается шариками — собирай, и с каждым ты или {avaia} станете опытнее.",
  "guide.territory.newGround.2":
    "Первая клетка — твоя. Таймер над клеткой показывает, сколько ей ещё открываться. А на открытой земле собирай шарики: за каждый ты или {avaia} станете опытнее.",
  "guide.reward.together.1": "Теперь идите — ты и {avaia}. Я вас найду.",
  "guide.choice.curious.0.feminine":
    "Это странно. Я чувствую, что уже была здесь.",
  "guide.choice.curious.0.masculine":
    "Это странно. Я чувствую, что уже был здесь.",
  "guide.choice.curious.0.neutral":
    "Это странно. Будто здесь уже доводилось бывать.",
  "guide.choice.curious.1.feminine":
    "Странно… будто я уже здесь когда-то была.",
  "guide.choice.curious.1.masculine":
    "Странно… будто я уже здесь когда-то был.",
  "guide.choice.curious.1.neutral": "Странно… будто всё это уже когда-то было.",
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
