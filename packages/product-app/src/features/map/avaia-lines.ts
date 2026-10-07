// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCue } from "@nilx-one/host-contract";
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
  | "stroll"
  | "blocked.building"
  | "blocked.water"
  | "blocked.fog"
  | "landmark.spotted"
  | "landmark.glanced"
  | "landmark.studied"
  | "landmark.loved"
  | "landmark.longing"
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
    stroll: [
      "Stretching my legs.",
      "A few steps. Nothing far.",
      "Just checking the air around here.",
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
    "landmark.glanced": [
      "{landmark}. Worth the detour.",
      "Had to see {landmark} up close.",
      "{landmark}. Good bearing from here.",
    ],
    "landmark.studied": [
      "{landmark}. Noted.",
      "So that's {landmark}. Logged it.",
      "{landmark}. Now I know.",
      "Marked on my chart: {landmark}.",
    ],
    "landmark.loved": [
      "{landmark}. This one's mine now.",
      "{landmark}. A heading I'll keep.",
      "Some places become a course. {landmark} is one.",
    ],
    "landmark.longing": [
      "Back to {landmark}. Course set.",
      "{landmark}, again. Heading over.",
      "I know the way to {landmark}.",
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
    stroll: [
      "I'll just wander about a little.",
      "Ooh, what's round the corner?",
      "Can't stand still. A tiny stroll!",
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
    "landmark.glanced": [
      "Ooh, {landmark}! Just a peek.",
      "I had to stop for {landmark}.",
      "{landmark} — look at it!",
    ],
    "landmark.studied": [
      "{landmark}. I'll remember it now.",
      "Wrote it down: {landmark}.",
      "So pretty. {landmark}, noted.",
      "{landmark}. Added to my little book.",
    ],
    "landmark.loved": [
      "Okay, I'm in love with {landmark}.",
      "{landmark}! My favourite place, officially.",
      "I could stay at {landmark} forever.",
    ],
    "landmark.longing": [
      "I miss {landmark}. Going back!",
      "Let's visit {landmark} again, please?",
      "{landmark}, here I come again!",
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
    stroll: [
      "Pacing. It's what we do.",
      "Standing still was getting old.",
      "A short walk to nowhere in particular.",
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
    "landmark.glanced": [
      "{landmark}. I stopped. Character development.",
      "Brief detour for {landmark}. No regrets.",
      "{landmark}. Yes, I looked.",
    ],
    "landmark.studied": [
      "{landmark}: examined. Opinions pending.",
      "Logged {landmark}. The archive approves.",
      "{landmark}. Filed under things that stand still.",
      "{landmark}, done. It was very… there.",
    ],
    "landmark.loved": [
      "Fine. I like {landmark}. Don't tell anyone.",
      "{landmark}. Upgraded from 'thing' to 'my thing'.",
      "Apparently I have a favourite now: {landmark}.",
    ],
    "landmark.longing": [
      "Going back to {landmark}. Purely for research.",
      "{landmark} again. Consistent, not obsessed.",
      "My feet say {landmark}. Not arguing.",
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
    stroll: [
      "Strutting about a bit.",
      "A little lap to break in the shoes.",
      "Can't just stand there. Stroll time.",
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
    "landmark.glanced": [
      "{landmark}. Great backdrop.",
      "Pausing for {landmark}, obviously.",
      "{landmark} matches the outfit.",
    ],
    "landmark.studied": [
      "{landmark}. Archived, like a good look.",
      "Got it: {landmark}. Very iconic.",
      "{landmark}. Saved to favourites.",
      "{landmark}: studied and styled.",
    ],
    "landmark.loved": [
      "{landmark}. Officially my aesthetic.",
      "In love with {landmark}. It's a whole mood.",
      "{landmark}: my spot. Pinned forever.",
    ],
    "landmark.longing": [
      "{landmark} again. A classic never goes out of style.",
      "Back to {landmark}. It suits me.",
      "{landmark}, back in my look of the day.",
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
    stroll: [
      "Розімну ноги.",
      "Кілька кроків. Недалеко.",
      "Перевірю повітря поблизу.",
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
    "landmark.glanced": [
      "{landmark}. Вартувало звернути.",
      "{landmark} — довелося глянути зблизька.",
      "{landmark}. Добрий орієнтир.",
    ],
    "landmark.studied": [
      "{landmark}. Занотовано.",
      "Он воно що: {landmark}. Записав.",
      "{landmark}. Тепер знаю.",
      "Позначив на своїй карті: {landmark}.",
    ],
    "landmark.loved": [
      "{landmark}. Тепер це моє місце.",
      "{landmark} — мій орієнтир відтепер.",
      "Деякі місця стають курсом. {landmark} — з таких.",
    ],
    "landmark.longing": [
      "Курс — {landmark}. Повертаюся.",
      "Знову туди: {landmark}. Іду.",
      "Дорогу знаю: {landmark}.",
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
    stroll: [
      "Трохи поблукаю тут.",
      "Ой, а що там за рогом?",
      "Не можу стояти на місці. Маленька прогулянка!",
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
    "landmark.glanced": [
      "Ой, {landmark}! Лише одним оком.",
      "{landmark} — я мусила зупинитися.",
      "{landmark}! Ти тільки поглянь.",
    ],
    "landmark.studied": [
      "{landmark}. Тепер запам’ятаю.",
      "Записала: {landmark}.",
      "Яка краса. {landmark}, занотовано.",
      "{landmark}. Додала до своєї книжечки.",
    ],
    "landmark.loved": [
      "Здається, я закохалася: {landmark}.",
      "{landmark}! Офіційно моє улюблене місце.",
      "{landmark}… Я б тут лишилася назавжди.",
    ],
    "landmark.longing": [
      "Скучила: {landmark}. Повертаюся!",
      "{landmark} — ще разочок, можна?",
      "Біжу знову: {landmark}!",
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
    stroll: [
      "Походжу. Це в нас таке.",
      "Стояти на місці набридло.",
      "Коротка прогулянка в нікуди.",
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
    "landmark.glanced": [
      "{landmark}. Зупинка. Розвиток персонажа.",
      "{landmark} — короткий гачок. Без жалю.",
      "{landmark}. Так, подивитися довелося.",
    ],
    "landmark.studied": [
      "{landmark}: оглянуто. Думки згодом.",
      "Внесено: {landmark}. Архів схвалює.",
      "{landmark}. У теку «речі, що стоять на місці».",
      "{landmark} — готово. Воно було дуже… тут.",
    ],
    "landmark.loved": [
      "Гаразд. Мені тут подобається: {landmark}. Нікому ні слова.",
      "{landmark}: підвищення з «річ» до «моя річ».",
      "Схоже, тепер є улюблене місце: {landmark}.",
    ],
    "landmark.longing": [
      "Знову {landmark}. Суто з наукових міркувань.",
      "{landmark} ще раз. Це послідовність, а не одержимість.",
      "Ноги кажуть: {landmark}. Не сперечаюся.",
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
    stroll: [
      "Трохи пройдуся тут.",
      "Маленьке коло — розносити туфлі.",
      "Не стоятиму ж я просто так. Час прогулянки.",
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
    "landmark.glanced": [
      "{landmark}. Чудове тло.",
      "{landmark} — звісно, я зупинилася.",
      "{landmark} пасує до образу.",
    ],
    "landmark.studied": [
      "{landmark}. В архіві, як вдалий образ.",
      "Є: {landmark}. Дуже знаково.",
      "{landmark}. Додала в обране.",
      "{landmark}: вивчено й оцінено.",
    ],
    "landmark.loved": [
      "{landmark}. Офіційно моя естетика.",
      "Закохалася: {landmark}. Це настрій.",
      "{landmark} — моє місце. Закріпила назавжди.",
    ],
    "landmark.longing": [
      "Знову {landmark}. Класика не виходить з моди.",
      "Повертаюся: {landmark}. Мені личить.",
      "{landmark} — знову в моєму образі дня.",
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
    stroll: [
      "Разомну ноги.",
      "Пара шагов. Недалеко.",
      "Проверю воздух поблизости.",
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
    "landmark.glanced": [
      "{landmark}. Стоило свернуть.",
      "{landmark} — пришлось взглянуть вблизи.",
      "{landmark}. Хороший ориентир.",
    ],
    "landmark.studied": [
      "{landmark}. Записано.",
      "Вот оно что: {landmark}. Записал.",
      "{landmark}. Теперь знаю.",
      "Отметил на своей карте: {landmark}.",
    ],
    "landmark.loved": [
      "{landmark}. Теперь это моё место.",
      "{landmark} — мой ориентир отныне.",
      "Некоторые места становятся курсом. {landmark} — из таких.",
    ],
    "landmark.longing": [
      "Курс — {landmark}. Возвращаюсь.",
      "Снова туда: {landmark}. Иду.",
      "Дорогу знаю: {landmark}.",
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
    stroll: [
      "Немножко поброжу тут.",
      "Ой, а что там за углом?",
      "Не могу стоять на месте. Маленькая прогулка!",
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
    "landmark.glanced": [
      "Ой, {landmark}! Только одним глазком.",
      "{landmark} — я должна была остановиться.",
      "{landmark}! Ты только посмотри.",
    ],
    "landmark.studied": [
      "{landmark}. Теперь запомню.",
      "Записала: {landmark}.",
      "Какая красота. {landmark}, записано.",
      "{landmark}. Добавила в свою книжечку.",
    ],
    "landmark.loved": [
      "Кажется, я влюбилась: {landmark}.",
      "{landmark}! Официально моё любимое место.",
      "{landmark}… Я бы осталась тут навсегда.",
    ],
    "landmark.longing": [
      "Соскучилась: {landmark}. Возвращаюсь!",
      "{landmark} — ещё разочек, можно?",
      "Бегу снова: {landmark}!",
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
    stroll: [
      "Похожу. У нас так принято.",
      "Стоять на месте надоело.",
      "Короткая прогулка в никуда.",
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
    "landmark.glanced": [
      "{landmark}. Остановка. Развитие персонажа.",
      "{landmark} — короткий крюк. Без сожалений.",
      "{landmark}. Да, посмотреть пришлось.",
    ],
    "landmark.studied": [
      "{landmark}: осмотрено. Мнения позже.",
      "Внесено: {landmark}. Архив одобряет.",
      "{landmark}. В папку «вещи, которые стоят на месте».",
      "{landmark} — готово. Оно было очень… здесь.",
    ],
    "landmark.loved": [
      "Ладно. Мне здесь нравится: {landmark}. Никому ни слова.",
      "{landmark}: повышение с «вещь» до «моя вещь».",
      "Похоже, теперь есть любимое место: {landmark}.",
    ],
    "landmark.longing": [
      "Снова {landmark}. Исключительно в научных целях.",
      "{landmark} ещё раз. Это последовательность, а не одержимость.",
      "Ноги говорят: {landmark}. Не спорю.",
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
    stroll: [
      "Немного пройдусь тут.",
      "Маленький круг — разносить туфли.",
      "Не стоять же просто так. Время прогулки.",
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
    "landmark.glanced": [
      "{landmark}. Отличный фон.",
      "{landmark} — конечно, я остановилась.",
      "{landmark} подходит к образу.",
    ],
    "landmark.studied": [
      "{landmark}. В архиве, как удачный образ.",
      "Есть: {landmark}. Очень культово.",
      "{landmark}. Добавила в избранное.",
      "{landmark}: изучено и оценено.",
    ],
    "landmark.loved": [
      "{landmark}. Официально моя эстетика.",
      "Влюбилась: {landmark}. Это настроение.",
      "{landmark} — моё место. Закрепила навсегда.",
    ],
    "landmark.longing": [
      "Снова {landmark}. Классика не выходит из моды.",
      "Возвращаюсь: {landmark}. Мне идёт.",
      "{landmark} — снова в моём образе дня.",
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

/**
 * The sound that goes with a line, when one does. The line is still the fact
 * and is still written; the cue only marks that it was said. A revealed cell
 * has its own cue wherever the reveal came from, so its line adds none.
 */
export function lineCue(kind: AvaiaLineKind): SoundCue | undefined {
  switch (kind) {
    case "walk":
    case "stroll":
    case "fog.reveal":
      return "walk";
    case "blocked.building":
    case "blocked.water":
    case "blocked.fog":
    case "fog.busy":
      return "refuse";
    case "landmark.spotted":
    case "landmark.glanced":
    case "landmark.longing":
      return "spot";
    case "landmark.studied":
    case "landmark.loved":
      return "study";
    case "fog.revealed":
      return undefined;
  }
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
