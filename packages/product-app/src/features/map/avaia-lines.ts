// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvatarModelId,
  MapGround,
  MapLandmark,
} from "@nilx-one/map-contract";

import type { ProductLocale } from "../../shell/localization";

/**
 * What an Avaia says to itself while it walks.
 *
 * Every study has its own voice, and the voice belongs to the body rather than
 * to the address: the same Avaia in a different study talks differently, the
 * way a character does. Each line is presentation copy written for a locale —
 * never generated, never sent anywhere, never a message to anyone.
 *
 * Ukrainian and Russian lines keep the grammatical gender of the study that says them:
 * Sky speaks in the masculine, both Dashas in the feminine, and Kai in forms
 * that carry no gender at all.
 */
export type AvaiaLineKind =
  | "walk"
  | "blocked.building"
  | "blocked.water"
  | "blocked.fog"
  | "landmark.spotted"
  | "landmark.studied"
  | "fog.reveal"
  | "fog.revealed"
  | "fog.busy";

type Voice = Readonly<Record<AvaiaLineKind, readonly string[]>>;

const EN: Readonly<Record<AvatarModelId, Voice>> = {
  "sky-study": {
    walk: [
      "Right. That way.",
      "Let's see what the wind says over there.",
      "Heading out. Clear skies on this route.",
      "A short flight, on foot.",
      "Plotting a course.",
      "I'll take a look over there.",
      "On my way. The horizon can wait.",
      "Good spot. Going.",
    ],
    "blocked.building": [
      "That's a wall, not a path.",
      "Even the sky goes around buildings.",
      "I don't walk through houses.",
    ],
    "blocked.water": [
      "Not without a boat.",
      "Water. I'll pass.",
      "Too wet for a walk.",
    ],
    "blocked.fog": [
      "Fog. Not until you've been there.",
      "I can't see that far yet.",
      "You go first. Then I'll follow.",
    ],
    "landmark.spotted": [
      "{landmark}. Worth a closer look.",
      "Something on the skyline: {landmark}.",
      "{landmark} is out there. Going to see it.",
      "{landmark}. Let me check.",
    ],
    "landmark.studied": [
      "{landmark}. Noted.",
      "So that's {landmark}. Logged it.",
      "{landmark}. Now I know.",
      "Marked on my chart: {landmark}.",
    ],
    "fog.reveal": [
      "Into the fog. I'll chart it.",
      "Clearing that patch. Give me a few minutes.",
      "Heading in. The map will fill.",
    ],
    "fog.revealed": [
      "Charted. The fog's gone there.",
      "Clear skies over that patch now.",
      "Done. One more piece of the map.",
    ],
    "fog.busy": [
      "Three at once is my limit.",
      "I'm already clearing three.",
      "Hands full. Wait for one to clear.",
    ],
  },
  "dasha-study": {
    walk: [
      "Ooh, I'll go there!",
      "Let's take a little walk.",
      "What's over there? Going to find out.",
      "A stroll it is!",
      "Right, I'm off.",
      "That looks nice. Coming!",
      "Just a peek, I promise.",
      "Going, going…",
    ],
    "blocked.building": [
      "That's somebody's house!",
      "Walls. Not my style.",
      "I can't go through that, silly.",
    ],
    "blocked.water": [
      "I didn't bring a swimsuit.",
      "Water! No, thanks.",
      "My shoes say no.",
    ],
    "blocked.fog": [
      "It's all grey there. Show me first?",
      "I don't go where you haven't been.",
      "Too foggy. You first!",
    ],
    "landmark.spotted": [
      "Wait, {landmark}! I have to see.",
      "{landmark}? Ooh, going!",
      "You walked right past {landmark}. My turn!",
      "Look, {landmark}. Let me get closer.",
    ],
    "landmark.studied": [
      "{landmark}. I'll remember it now.",
      "Wrote it down: {landmark}.",
      "So pretty. {landmark}, noted.",
      "{landmark}. Added to my little book.",
    ],
    "fog.reveal": [
      "Ooh, a mystery patch! Going in.",
      "Let me clear that up for you!",
      "Into the grey I go!",
    ],
    "fog.revealed": [
      "Ta-da! It's all visible now.",
      "Look, no more fog there!",
      "Cleared it. Pretty, isn't it?",
    ],
    "fog.busy": [
      "I'm doing three already!",
      "One sec, three is plenty.",
      "Too many! Let me finish these first.",
    ],
  },
  "kai-study": {
    walk: [
      "Sure, why not. Going.",
      "The map says there's a there there.",
      "Plot twist: I'm walking.",
      "Off to be somewhere else, briefly.",
      "Walking. Very advanced technology.",
      "Onward, in the loosest sense.",
      "Fine, I'll go look. For science.",
      "Relocating one (1) Avaia.",
    ],
    "blocked.building": [
      "Bold of you to assume I phase through walls.",
      "That's architecture. I respect it.",
      "Door not found.",
    ],
    "blocked.water": [
      "I'm many things. A boat isn't one.",
      "Water. Hard pass.",
      "Swimming isn't in my clips.",
    ],
    "blocked.fog": [
      "Unrevealed territory. Pass.",
      "Fog of war. Classic.",
      "Reveal it first, then we'll talk.",
    ],
    "landmark.spotted": [
      "{landmark}. Suspiciously historic. Investigating.",
      "Oh look, {landmark}. Going to stare at it.",
      "{landmark} spotted. Curiosity: engaged.",
      "{landmark} isn't going anywhere. I am.",
    ],
    "landmark.studied": [
      "{landmark}: examined. Opinions pending.",
      "Logged {landmark}. The archive approves.",
      "{landmark}. Filed under things that stand still.",
      "{landmark}, done. It was very… there.",
    ],
    "fog.reveal": [
      "Deploying one (1) fog remover.",
      "Fine. Revealing the unrevealed.",
      "Going to make that less grey.",
    ],
    "fog.revealed": [
      "Fog: removed. You're welcome.",
      "Revealed. It was a map all along.",
      "Done. Territory unlocked.",
    ],
    "fog.busy": [
      "Three in progress. I'm not a cluster.",
      "Queue's full. Three max.",
      "Parallelism limit reached: three.",
    ],
  },
  "dasha-v2-study": {
    walk: [
      "New look, new route.",
      "This outfit deserves a walk.",
      "The runway's that way.",
      "Let's go. Version two walks faster.",
      "I'll be over there, looking fabulous.",
      "A little stroll to show off the fit.",
      "Updating my location…",
      "Coming through, in style.",
    ],
    "blocked.building": [
      "Not through a wall, darling.",
      "That door isn't my size.",
      "That's a building. I'd ruin the look.",
    ],
    "blocked.water": [
      "Not in these shoes.",
      "Water ruins fabric.",
      "No swim today, thanks.",
    ],
    "blocked.fog": [
      "Grey isn't my colour. Reveal it first.",
      "I don't do unmapped.",
      "You scout, I'll follow.",
    ],
    "landmark.spotted": [
      "{landmark}. Perfect backdrop. Going.",
      "Is that {landmark}? Photo op!",
      "{landmark}. I must see it up close.",
      "Found one: {landmark}. My turn now.",
    ],
    "landmark.studied": [
      "{landmark}. Archived, like a good look.",
      "Got it: {landmark}. Very iconic.",
      "{landmark}. Saved to favourites.",
      "{landmark}: studied and styled.",
    ],
    "fog.reveal": [
      "Let's give that patch a makeover.",
      "Grey is so last season. Clearing it.",
      "Going to reveal that look.",
    ],
    "fog.revealed": [
      "Revealed. Much better.",
      "There. Fog is out of fashion.",
      "All clear, and it suits the map.",
    ],
    "fog.busy": [
      "Three at once, darling. That's the limit.",
      "Already styling three. Wait.",
      "Three's my maximum. Patience.",
    ],
  },
};

const UK: Readonly<Record<AvatarModelId, Voice>> = {
  "sky-study": {
    walk: [
      "Гаразд. Туди.",
      "Подивлюся, що там каже вітер.",
      "Вирушаю. На цьому маршруті ясно.",
      "Короткий політ, тільки пішки.",
      "Прокладаю курс.",
      "Гляну, що там.",
      "Іду. Горизонт почекає.",
      "Добре місце. Рушаю.",
    ],
    "blocked.building": [
      "Це стіна, а не стежка.",
      "Навіть небо оминає будинки.",
      "Крізь будинки я не ходжу.",
    ],
    "blocked.water": [
      "Без човна — ні.",
      "Вода. Пропущу.",
      "Для прогулянки мокрувато.",
    ],
    "blocked.fog": [
      "Туман. Спершу там маєш побувати ти.",
      "Так далеко я ще не бачу.",
      "Спершу ти. Тоді я.",
    ],
    "landmark.spotted": [
      "{landmark}. Варто глянути ближче.",
      "Щось видніється на обрії: {landmark}.",
      "Там {landmark}. Піду подивлюся.",
      "{landmark}. Перевірю.",
    ],
    "landmark.studied": [
      "{landmark}. Занотовано.",
      "Он воно що: {landmark}. Записав.",
      "{landmark}. Тепер знаю.",
      "Позначив на своїй карті: {landmark}.",
    ],
    "fog.reveal": [
      "У туман. Нанесу на карту.",
      "Розчищу цю ділянку. Дай кілька хвилин.",
      "Заходжу. Мапа заповниться.",
    ],
    "fog.revealed": [
      "Наніс на карту. Туману там більше нема.",
      "Над тією ділянкою тепер ясно.",
      "Готово. Ще один шматок мапи.",
    ],
    "fog.busy": [
      "Три одночасно — моя межа.",
      "Я вже розчищаю три.",
      "Руки зайняті. Зачекай, поки одна відкриється.",
    ],
  },
  "dasha-study": {
    walk: [
      "Ой, піду туди!",
      "Прогуляюся трішки.",
      "А що там? Зараз дізнаюся.",
      "Отже, прогулянка!",
      "Все, я пішла.",
      "Там гарно. Біжу!",
      "Лише одним оком, чесно.",
      "Іду-іду…",
    ],
    "blocked.building": [
      "Це ж чийсь дім!",
      "Стіни — не мій стиль.",
      "Крізь це не пройду, ну.",
    ],
    "blocked.water": [
      "Я не взяла купальник.",
      "Вода! Ні, дякую.",
      "Мої черевики кажуть «ні».",
    ],
    "blocked.fog": [
      "Там усе сіре. Покажеш спершу?",
      "Туди, де ще не ступала твоя нога, я не ходжу.",
      "Затуманено. Спершу ти!",
    ],
    "landmark.spotted": [
      "Стривай, {landmark}! Мушу побачити.",
      "{landmark}? Ой, іду!",
      "Он, {landmark}. Тепер моя черга!",
      "Дивись, {landmark}. Гляну ближче.",
    ],
    "landmark.studied": [
      "{landmark}. Тепер запам’ятаю.",
      "Записала: {landmark}.",
      "Яка краса. {landmark}, занотовано.",
      "{landmark}. Додала до своєї книжечки.",
    ],
    "fog.reveal": [
      "Ой, таємнича ділянка! Іду.",
      "Зараз я її розчищу!",
      "Пірнаю в сірість!",
    ],
    "fog.revealed": [
      "Та-дам! Тепер усе видно.",
      "Дивись, там більше нема туману!",
      "Розчистила. Гарно ж?",
    ],
    "fog.busy": [
      "Я вже роблю три!",
      "Секунду, трьох досить.",
      "Забагато! Спершу закінчу ці.",
    ],
  },
  "kai-study": {
    walk: [
      "Та чому б і ні. Іду.",
      "Карта каже, що там щось є.",
      "Несподіваний поворот: я йду.",
      "Ненадовго буду деінде.",
      "Ходьба. Дуже передова технологія.",
      "Вперед, у найширшому сенсі.",
      "Гаразд, гляну. Заради науки.",
      "Переміщую одну (1) Avaia.",
    ],
    "blocked.building": [
      "Сміливо думати, що я ходжу крізь стіни.",
      "Це архітектура. Я її поважаю.",
      "Двері не знайдено.",
    ],
    "blocked.water": [
      "Я багато чого вмію. Бути човном — ні.",
      "Вода. Рішуче ні.",
      "Плавання немає в моїх анімаціях.",
    ],
    "blocked.fog": [
      "Невідкрита територія. Пас.",
      "Туман війни. Класика.",
      "Спершу відкрий, тоді поговоримо.",
    ],
    "landmark.spotted": [
      "{landmark}. Підозріло історично. Розслідую.",
      "О, {landmark}. Піду повитріщаюся.",
      "Помічено: {landmark}. Цікавість увімкнено.",
      "{landmark} нікуди не дінеться. А я — так.",
    ],
    "landmark.studied": [
      "{landmark}: оглянуто. Думки згодом.",
      "Внесено: {landmark}. Архів схвалює.",
      "{landmark}. У теку «речі, що стоять на місці».",
      "{landmark} — готово. Воно було дуже… тут.",
    ],
    "fog.reveal": [
      "Запускаю один (1) туманоприбирач.",
      "Гаразд. Відкриваю невідкрите.",
      "Зроблю це менш сірим.",
    ],
    "fog.revealed": [
      "Туман: видалено. Прошу.",
      "Відкрито. Весь час це була мапа.",
      "Готово. Територію розблоковано.",
    ],
    "fog.busy": [
      "Три в процесі. Я не кластер.",
      "Черга повна. Максимум три.",
      "Ліміт паралельності: три.",
    ],
  },
  "dasha-v2-study": {
    walk: [
      "Новий образ — новий маршрут.",
      "Це вбрання заслуговує на прогулянку.",
      "Подіум — там.",
      "Ходімо. Друга версія ходить швидше.",
      "Буду там, виглядатиму неймовірно.",
      "Коротка прогулянка — показати образ.",
      "Оновлюю свою локацію…",
      "Дайте дорогу, я стильно.",
    ],
    "blocked.building": [
      "Не крізь стіну, любий.",
      "Ці двері не мого розміру.",
      "Це будівля. Зіпсую образ.",
    ],
    "blocked.water": [
      "Не в цих черевиках.",
      "Вода псує тканину.",
      "Сьогодні без запливу.",
    ],
    "blocked.fog": [
      "Сірий — не мій колір. Спершу відкрий.",
      "Незнане — не для мене.",
      "Ти розвідай, я — слідом.",
    ],
    "landmark.spotted": [
      "{landmark}. Ідеальне тло. Іду.",
      "Це {landmark}? Час для фото!",
      "{landmark}. Мушу побачити зблизька.",
      "Знахідка: {landmark}. Тепер іду я.",
    ],
    "landmark.studied": [
      "{landmark}. В архіві, як вдалий образ.",
      "Є: {landmark}. Дуже знаково.",
      "{landmark}. Додала в обране.",
      "{landmark}: вивчено й оцінено.",
    ],
    "fog.reveal": [
      "Зробимо цій ділянці макіяж.",
      "Сірий — це минулий сезон. Розчищаю.",
      "Іду відкривати цей образ.",
    ],
    "fog.revealed": [
      "Відкрила. Так значно краще.",
      "Ось. Туман вийшов з моди.",
      "Усе чисто — і мапі личить.",
    ],
    "fog.busy": [
      "Три одночасно, любчику. Це межа.",
      "Я вже стилізую три. Зачекай.",
      "Три — мій максимум. Терпіння.",
    ],
  },
};

const RU: Readonly<Record<AvatarModelId, Voice>> = {
  "sky-study": {
    walk: [
      "Ладно. Туда.",
      "Посмотрю, что там говорит ветер.",
      "Выдвигаюсь. На этом маршруте ясно.",
      "Короткий полёт, только пешком.",
      "Прокладываю курс.",
      "Гляну, что там.",
      "Иду. Горизонт подождёт.",
      "Хорошее место. Выдвигаюсь.",
    ],
    "blocked.building": [
      "Это стена, а не тропа.",
      "Даже небо обходит дома.",
      "Сквозь дома я не хожу.",
    ],
    "blocked.water": [
      "Без лодки — нет.",
      "Вода. Пропущу.",
      "Для прогулки мокровато.",
    ],
    "blocked.fog": [
      "Туман. Сначала там надо побывать тебе.",
      "Так далеко я ещё не вижу.",
      "Сначала ты. Потом я.",
    ],
    "landmark.spotted": [
      "{landmark}. Стоит взглянуть поближе.",
      "Что-то виднеется на горизонте: {landmark}.",
      "Там {landmark}. Пойду посмотрю.",
      "{landmark}. Проверю.",
    ],
    "landmark.studied": [
      "{landmark}. Записано.",
      "Вот оно что: {landmark}. Записал.",
      "{landmark}. Теперь знаю.",
      "Отметил на своей карте: {landmark}.",
    ],
    "fog.reveal": [
      "В туман. Нанесу на карту.",
      "Расчищу этот участок. Дай пару минут.",
      "Захожу. Карта заполнится.",
    ],
    "fog.revealed": [
      "Нанёс на карту. Тумана там больше нет.",
      "Над тем участком теперь ясно.",
      "Готово. Ещё один кусок карты.",
    ],
    "fog.busy": [
      "Три одновременно — мой предел.",
      "Я уже расчищаю три.",
      "Руки заняты. Подожди, пока одна откроется.",
    ],
  },
  "dasha-study": {
    walk: [
      "Ой, пойду туда!",
      "Немножко прогуляюсь.",
      "А что там? Сейчас узнаю.",
      "Значит, прогулка!",
      "Всё, я пошла.",
      "Там красиво. Бегу!",
      "Только одним глазком, честно.",
      "Иду-иду…",
    ],
    "blocked.building": [
      "Это же чей-то дом!",
      "Стены — не мой стиль.",
      "Сквозь это не пройду, ну.",
    ],
    "blocked.water": [
      "Я не взяла купальник.",
      "Вода! Нет, спасибо.",
      "Мои туфли говорят «нет».",
    ],
    "blocked.fog": [
      "Там всё серое. Покажешь сначала?",
      "Туда, где ещё не ступала твоя нога, я не хожу.",
      "Туманно. Сначала ты!",
    ],
    "landmark.spotted": [
      "Погоди, {landmark}! Должна увидеть.",
      "{landmark}? Ой, иду!",
      "Вон, {landmark}. Теперь моя очередь!",
      "Смотри, {landmark}. Гляну поближе.",
    ],
    "landmark.studied": [
      "{landmark}. Теперь запомню.",
      "Записала: {landmark}.",
      "Какая красота. {landmark}, записано.",
      "{landmark}. Добавила в свою книжечку.",
    ],
    "fog.reveal": [
      "Ой, таинственный участок! Иду.",
      "Сейчас я его расчищу!",
      "Ныряю в серость!",
    ],
    "fog.revealed": [
      "Та-дам! Теперь всё видно.",
      "Смотри, там больше нет тумана!",
      "Расчистила. Красиво же?",
    ],
    "fog.busy": [
      "Я уже делаю три!",
      "Секунду, трёх хватит.",
      "Слишком много! Сначала закончу эти.",
    ],
  },
  "kai-study": {
    walk: [
      "А почему бы и нет. Иду.",
      "Карта говорит, что там что-то есть.",
      "Неожиданный поворот: я иду.",
      "Ненадолго буду где-то ещё.",
      "Ходьба. Очень передовая технология.",
      "Вперёд, в самом широком смысле.",
      "Ладно, гляну. Ради науки.",
      "Перемещаю одну (1) Avaia.",
    ],
    "blocked.building": [
      "Смело думать, что я хожу сквозь стены.",
      "Это архитектура. Я её уважаю.",
      "Дверь не найдена.",
    ],
    "blocked.water": [
      "Я много что умею. Быть лодкой — нет.",
      "Вода. Решительно нет.",
      "Плавания нет в моих анимациях.",
    ],
    "blocked.fog": [
      "Неоткрытая территория. Пас.",
      "Туман войны. Классика.",
      "Сначала открой, потом поговорим.",
    ],
    "landmark.spotted": [
      "{landmark}. Подозрительно исторично. Расследую.",
      "О, {landmark}. Пойду поглазею.",
      "Замечено: {landmark}. Любопытство включено.",
      "{landmark} никуда не денется. А я — да.",
    ],
    "landmark.studied": [
      "{landmark}: осмотрено. Мнения позже.",
      "Внесено: {landmark}. Архив одобряет.",
      "{landmark}. В папку «вещи, которые стоят на месте».",
      "{landmark} — готово. Оно было очень… здесь.",
    ],
    "fog.reveal": [
      "Запускаю один (1) туманоуборщик.",
      "Ладно. Открываю неоткрытое.",
      "Сделаю это менее серым.",
    ],
    "fog.revealed": [
      "Туман: удалён. Пожалуйста.",
      "Открыто. Всё это время это была карта.",
      "Готово. Территория разблокирована.",
    ],
    "fog.busy": [
      "Три в процессе. Я не кластер.",
      "Очередь полна. Максимум три.",
      "Лимит параллельности: три.",
    ],
  },
  "dasha-v2-study": {
    walk: [
      "Новый образ — новый маршрут.",
      "Этот наряд заслуживает прогулки.",
      "Подиум — там.",
      "Пошли. Вторая версия ходит быстрее.",
      "Буду там, выглядеть потрясающе.",
      "Короткая прогулка — показать образ.",
      "Обновляю своё местоположение…",
      "Дорогу, я при параде.",
    ],
    "blocked.building": [
      "Не сквозь стену, дорогой.",
      "Эта дверь не моего размера.",
      "Это здание. Испорчу образ.",
    ],
    "blocked.water": [
      "Не в этих туфлях.",
      "Вода портит ткань.",
      "Сегодня без заплыва.",
    ],
    "blocked.fog": [
      "Серый — не мой цвет. Сначала открой.",
      "Неизведанное — не для меня.",
      "Ты разведай, я — следом.",
    ],
    "landmark.spotted": [
      "{landmark}. Идеальный фон. Иду.",
      "Это {landmark}? Время для фото!",
      "{landmark}. Должна увидеть вблизи.",
      "Находка: {landmark}. Теперь иду я.",
    ],
    "landmark.studied": [
      "{landmark}. В архиве, как удачный образ.",
      "Есть: {landmark}. Очень культово.",
      "{landmark}. Добавила в избранное.",
      "{landmark}: изучено и оценено.",
    ],
    "fog.reveal": [
      "Сделаем этому участку макияж.",
      "Серый — это прошлый сезон. Расчищаю.",
      "Иду открывать этот образ.",
    ],
    "fog.revealed": [
      "Открыла. Так гораздо лучше.",
      "Вот. Туман вышел из моды.",
      "Всё чисто — и карте идёт.",
    ],
    "fog.busy": [
      "Три одновременно, дорогой. Это предел.",
      "Я уже стилизую три. Подожди.",
      "Три — мой максимум. Терпение.",
    ],
  },
};

const VOICES: Readonly<
  Record<ProductLocale, Readonly<Record<AvatarModelId, Voice>>>
> = {
  en: EN,
  "uk-UA": UK,
  "ru-RU": RU,
};

/** What a landmark is called when the archive gives it no name. */
const KIND_LABELS: Readonly<
  Record<ProductLocale, Readonly<Record<string, string>>>
> = {
  en: {
    monument: "a monument",
    memorial: "a memorial",
    artwork: "an artwork",
    sculpture: "a sculpture",
    statue: "a statue",
    attraction: "an attraction",
    museum: "a museum",
    castle: "a castle",
    fort: "a fort",
    ruins: "ruins",
    archaeological_site: "an archaeological site",
    historic: "a historic place",
    landmark: "a landmark",
    viewpoint: "a viewpoint",
  },
  "uk-UA": {
    monument: "пам’ятник",
    memorial: "меморіал",
    artwork: "арт-об’єкт",
    sculpture: "скульптура",
    statue: "статуя",
    attraction: "визначне місце",
    museum: "музей",
    castle: "замок",
    fort: "форт",
    ruins: "руїни",
    archaeological_site: "археологічна пам’ятка",
    historic: "історичне місце",
    landmark: "визначна пам’ятка",
    viewpoint: "оглядовий майданчик",
  },
  "ru-RU": {
    monument: "памятник",
    memorial: "мемориал",
    artwork: "арт-объект",
    sculpture: "скульптура",
    statue: "статуя",
    attraction: "достопримечательность",
    museum: "музей",
    castle: "замок",
    fort: "форт",
    ruins: "руины",
    archaeological_site: "археологический памятник",
    historic: "историческое место",
    landmark: "примечательное место",
    viewpoint: "смотровая площадка",
  },
};

const FALLBACK_KIND: Readonly<Record<ProductLocale, string>> = {
  en: "something old",
  "uk-UA": "щось давнє",
  "ru-RU": "что-то старинное",
};

export function avaiaLines(
  locale: ProductLocale,
  model: AvatarModelId,
  kind: AvaiaLineKind,
): readonly string[] {
  return VOICES[locale][model][kind];
}

/** The line kind a refused tap is answered with. */
export function blockedLineKind(
  ground: Exclude<MapGround, "open">,
): AvaiaLineKind {
  return `blocked.${ground}`;
}

/** A localized kind, for a landmark the archive does not name. */
export function landmarkKindLabel(locale: ProductLocale, kind: string): string {
  return KIND_LABELS[locale][kind] ?? FALLBACK_KIND[locale];
}

/**
 * How a line names a landmark: by the archive's own name in this language when
 * it has one, by its plain name otherwise, and by what it is when it has none.
 */
export function landmarkLabel(
  locale: ProductLocale,
  landmark: MapLandmark,
): string {
  const language = locale === "uk-UA" ? "uk" : locale === "ru-RU" ? "ru" : "en";
  const localized = landmark.facts[`name:${language}`];
  const name =
    typeof localized === "string" && localized.length > 0
      ? localized
      : landmark.name;
  if (name === undefined || name.length === 0) {
    return landmarkKindLabel(locale, landmark.kind);
  }
  return locale === "en" ? `“${name}”` : `«${name}»`;
}

function capitalized(line: string): string {
  const first = line.codePointAt(0);
  if (first === undefined) return line;
  const head = String.fromCodePoint(first);
  return head.toLocaleUpperCase() + line.slice(head.length);
}

/**
 * Picks one line, never the one said last when there is another to say — a
 * character repeating itself on every click stops being a character.
 */
export function pickAvaiaLine({
  locale,
  model,
  kind,
  landmark,
  previous,
  random = Math.random,
}: {
  readonly locale: ProductLocale;
  readonly model: AvatarModelId;
  readonly kind: AvaiaLineKind;
  readonly landmark?: MapLandmark | undefined;
  readonly previous?: string | undefined;
  readonly random?: () => number;
}): string {
  const lines = avaiaLines(locale, model, kind);
  const label =
    landmark === undefined ? undefined : landmarkLabel(locale, landmark);
  const render = (template: string) =>
    capitalized(
      label === undefined ? template : template.replaceAll("{landmark}", label),
    );
  const fresh = lines.map(render).filter((line) => line !== previous);
  const pool = fresh.length > 0 ? fresh : lines.map(render);
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length)),
  );
  return pool[index] ?? "";
}
