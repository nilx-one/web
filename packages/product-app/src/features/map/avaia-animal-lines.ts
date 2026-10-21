// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvatarModelId } from "@nilx-one/map-contract";

import type { ProductLocale } from "../../shell/localization";

/**
 * What an Avaia says about the city's animals (docs/ambient-animals.md).
 *
 * The same rules as its other lines (`avaia-lines.ts`): the voice belongs to
 * the study, and Ukrainian and Russian keep its grammatical gender — Sky in
 * the masculine, both Dashas in the feminine, Kai in forms with no gender.
 * A dog or an eagle can startle it; that is said, never acted out.
 */
export type AvaiaAnimalLineKind =
  | "animal.squirrel"
  | "animal.cat"
  | "animal.dog"
  | "animal.piranha"
  | "animal.eagle"
  | "animal.startled.dog"
  | "animal.startled.eagle";

export const AVAIA_ANIMAL_LINE_KINDS: readonly AvaiaAnimalLineKind[] = [
  "animal.squirrel",
  "animal.cat",
  "animal.dog",
  "animal.piranha",
  "animal.eagle",
  "animal.startled.dog",
  "animal.startled.eagle",
];

export function isAnimalLine(kind: string): kind is AvaiaAnimalLineKind {
  return (AVAIA_ANIMAL_LINE_KINDS as readonly string[]).includes(kind);
}

type AnimalVoice = Readonly<Record<AvaiaAnimalLineKind, readonly string[]>>;

const EN: Readonly<Record<AvatarModelId, AnimalVoice>> = {
  "sky-study": {
    "animal.squirrel": [
      "A squirrel. Light on its feet.",
      "Squirrel at twelve o'clock.",
      "That one knows the trees better than I do.",
    ],
    "animal.cat": [
      "A cat. Holding its position.",
      "Cat on patrol.",
      "That cat's been watching me since we landed.",
    ],
    "animal.dog": [
      "A dog. Friendly, I hope.",
      "Dog on the path. Keeping my distance.",
      "Good dog. Probably.",
    ],
    "animal.piranha": [
      "Piranhas. Not a landing spot.",
      "Something with teeth in the water.",
      "I'll stay on dry ground, thanks.",
    ],
    "animal.eagle": [
      "An eagle. Now that's flying.",
      "Eagle overhead. Showing off.",
      "Look at it ride the wind.",
    ],
    "animal.startled.dog": [
      "Whoa — that dog came out of nowhere.",
      "Easy! I'm just passing.",
      "Dog. Evasive manoeuvres.",
    ],
    "animal.startled.eagle": [
      "Whoa, that eagle dived low!",
      "Too close, bird. Too close.",
      "Something big just buzzed me.",
    ],
  },
  "dasha-study": {
    "animal.squirrel": [
      "A squirrel! Hi, fluffy!",
      "Look at its tail!",
      "Ooh, a squirrel! I want to pet it.",
    ],
    "animal.cat": [
      "Kitty! Come here, kitty.",
      "A cat! It's ignoring me. Rude.",
      "Ooh, look at those whiskers.",
    ],
    "animal.dog": [
      "A doggy! Who's a good one?",
      "Look, a dog! Can I say hi?",
      "That dog's tail won't stop.",
    ],
    "animal.piranha": [
      "Fish! With teeth! Eek.",
      "Are those piranhas? In here?",
      "Not putting my fingers in there.",
    ],
    "animal.eagle": [
      "An eagle! It's so big!",
      "Look up, look up! An eagle!",
      "Wow, it's just floating up there.",
    ],
    "animal.startled.dog": [
      "Eek! It barked at me!",
      "Ah! Too big, too loud!",
      "Oh! That dog scared me.",
    ],
    "animal.startled.eagle": [
      "Eek! It flew right at me!",
      "Ah! Birds are scary up close.",
      "Oh no, it's swooping!",
    ],
  },
  "kai-study": {
    "animal.squirrel": [
      "A squirrel. Living its best life.",
      "Squirrel spotted. Very busy, apparently.",
      "One (1) squirrel. Rich in nuts.",
    ],
    "animal.cat": [
      "A cat. It has opinions about me.",
      "The cat has decided I'm beneath it.",
      "Cat. Judging, as usual.",
    ],
    "animal.dog": [
      "A dog. It seems happy to exist.",
      "Dog detected. Tail at full speed.",
      "A dog. Enthusiasm levels: high.",
    ],
    "animal.piranha": [
      "Piranhas. Of course there are piranhas.",
      "Fish with teeth. Nature's little joke.",
      "I'm not putting a hand in. Or anything.",
    ],
    "animal.eagle": [
      "An eagle. Showing off, frankly.",
      "Bird. Large. Unimpressed by me.",
      "An eagle. Airborne, unlike me.",
    ],
    "animal.startled.dog": [
      "That was a bark. No flinching. Mostly.",
      "Loud dog. Noted, with alarm.",
      "Okay. That dog is a lot.",
    ],
    "animal.startled.eagle": [
      "That bird came very close to my face.",
      "An eagle at eye level. Not ideal.",
      "Personal space, bird.",
    ],
  },
  "dasha-v2-study": {
    "animal.squirrel": [
      "A squirrel. Love the tail.",
      "That squirrel has better hair than me.",
      "Squirrel chic.",
    ],
    "animal.cat": [
      "A cat. So elegant.",
      "That cat is serving looks.",
      "Kitty, you're a whole mood.",
    ],
    "animal.dog": [
      "A dog! Mind the outfit, sweetie.",
      "Cute dog. Paws off the fabric.",
      "That pup's got style.",
    ],
    "animal.piranha": [
      "Piranhas. Not my kind of accessory.",
      "Teeth in the water. Hard pass.",
      "Not getting this dress wet near those.",
    ],
    "animal.eagle": [
      "An eagle. What a silhouette.",
      "Look at that wingspan. Iconic.",
      "That eagle owns the sky.",
    ],
    "animal.startled.dog": [
      "Ah! Not the shoes!",
      "Eek, it jumped at me!",
      "Down, darling, down!",
    ],
    "animal.startled.eagle": [
      "Ah! Watch the hair!",
      "Eek, it nearly grabbed me!",
      "Too close, bird. This is couture.",
    ],
  },
};

const UK: Readonly<Record<AvatarModelId, AnimalVoice>> = {
  "sky-study": {
    "animal.squirrel": [
      "Білка. Легка на ногу.",
      "Білка прямо по курсу.",
      "Ця знає дерева краще за мене.",
    ],
    "animal.cat": [
      "Кіт. Тримає позицію.",
      "Кіт на патрулі.",
      "Цей кіт стежить за мною від самої посадки.",
    ],
    "animal.dog": [
      "Пес. Сподіваюся, дружній.",
      "Пес на стежці. Тримаю дистанцію.",
      "Хороший пес. Мабуть.",
    ],
    "animal.piranha": [
      "Піраньї. Тут не приземлюся.",
      "У воді щось із зубами.",
      "Залишуся на суші, дякую.",
    ],
    "animal.eagle": [
      "Орел. Ось це політ.",
      "Орел над головою. Хизується.",
      "Дивись, як він ловить вітер.",
    ],
    "animal.startled.dog": [
      "Ого — цей пес вискочив нізвідки.",
      "Спокійно! Я просто проходжу.",
      "Пес. Аж здригнувся.",
    ],
    "animal.startled.eagle": [
      "Ого, орел пірнув так низько!",
      "Надто близько, птахо. Надто близько.",
      "Щось велике щойно пронеслося повз мене.",
    ],
  },
  "dasha-study": {
    "animal.squirrel": [
      "Білочка! Привіт, пухнаста!",
      "Подивись на її хвіст!",
      "Ой, білка! Хочу погладити.",
    ],
    "animal.cat": [
      "Котику! Ходи сюди.",
      "Кицька! Ігнорує мене. Неввічливо.",
      "Ой, які вуса!",
    ],
    "animal.dog": [
      "Песик! Хто тут хороший?",
      "Дивись, собака! Можна привітатися?",
      "У цього песика хвіст не зупиняється.",
    ],
    "animal.piranha": [
      "Рибки! З зубами! Ой.",
      "Це піраньї? Тут?",
      "Пальці туди не сую.",
    ],
    "animal.eagle": [
      "Орел! Який великий!",
      "Дивись угору! Орел!",
      "Ого, він просто ширяє.",
    ],
    "animal.startled.dog": [
      "Ой! Він на мене гавкнув!",
      "Ай! Завеликий і загучний!",
      "Ой! Я аж злякалася.",
    ],
    "animal.startled.eagle": [
      "Ой! Він летів прямо на мене!",
      "Ай! Птахи зблизька страшні.",
      "Ой лишенько, він пікірує!",
    ],
  },
  "kai-study": {
    "animal.squirrel": [
      "Білка. Живе на повну.",
      "Білку помічено. Дуже зайнята, вочевидь.",
      "Одна (1) білка. Багата на горіхи.",
    ],
    "animal.cat": [
      "Кіт. Має про мене думку.",
      "Кіт вирішив, що я нижче його гідності.",
      "Кіт. Оцінює, як завжди.",
    ],
    "animal.dog": [
      "Пес. Радіє самому факту існування.",
      "Виявлено пса. Хвіст на повній швидкості.",
      "Пес. Рівень ентузіазму: високий.",
    ],
    "animal.piranha": [
      "Піраньї. Ну звісно, піраньї.",
      "Риба з зубами. Маленький жарт природи.",
      "Руку туди не суну. І нічого іншого.",
    ],
    "animal.eagle": [
      "Орел. Хизується, якщо чесно.",
      "Птах. Великий. Мною не вражений.",
      "Орел. У повітрі, на відміну від мене.",
    ],
    "animal.startled.dog": [
      "Це був гавкіт. Жодного здригання. Майже.",
      "Гучний пес. Взято до уваги, з тривогою.",
      "Так. Цього пса забагато.",
    ],
    "animal.startled.eagle": [
      "Цей птах пролетів дуже близько до обличчя.",
      "Орел на рівні очей. Не ідеально.",
      "Особистий простір, птахо.",
    ],
  },
  "dasha-v2-study": {
    "animal.squirrel": [
      "Білка. Обожнюю цей хвіст.",
      "У цієї білки зачіска краща за мою.",
      "Білковий шик.",
    ],
    "animal.cat": [
      "Кіт. Така елегантність.",
      "Цей кіт — ціла естетика.",
      "Кицю, ти справжній настрій.",
    ],
    "animal.dog": [
      "Песик! Обережно з убранням, сонечко.",
      "Милий песик. Лапки геть від тканини.",
      "У цього цуцика є стиль.",
    ],
    "animal.piranha": [
      "Піраньї. Не мій аксесуар.",
      "Зуби у воді. Рішуче ні.",
      "Не мочитиму сукню біля них.",
    ],
    "animal.eagle": [
      "Орел. Який силует.",
      "Який розмах крил. Культово.",
      "Цей орел володіє небом.",
    ],
    "animal.startled.dog": [
      "Ай! Тільки не туфлі!",
      "Ой, я аж підскочила!",
      "Сидіти, любий, сидіти!",
    ],
    "animal.startled.eagle": [
      "Ай! Обережно, зачіска!",
      "Ой, він мало мене не схопив!",
      "Надто близько, птахо. Це від кутюр.",
    ],
  },
};

const RU: Readonly<Record<AvatarModelId, AnimalVoice>> = {
  "sky-study": {
    "animal.squirrel": [
      "Белка. Лёгкая на ногу.",
      "Белка прямо по курсу.",
      "Эта знает деревья лучше меня.",
    ],
    "animal.cat": [
      "Кот. Держит позицию.",
      "Кот в патруле.",
      "Этот кот следит за мной с самой посадки.",
    ],
    "animal.dog": [
      "Пёс. Надеюсь, дружелюбный.",
      "Пёс на тропе. Держу дистанцию.",
      "Хороший пёс. Наверное.",
    ],
    "animal.piranha": [
      "Пираньи. Здесь не приземлюсь.",
      "В воде что-то с зубами.",
      "Останусь на суше, спасибо.",
    ],
    "animal.eagle": [
      "Орёл. Вот это полёт.",
      "Орёл над головой. Красуется.",
      "Смотри, как он ловит ветер.",
    ],
    "animal.startled.dog": [
      "Ого — этот пёс выскочил из ниоткуда.",
      "Спокойно! Я просто прохожу.",
      "Пёс. Аж вздрогнул.",
    ],
    "animal.startled.eagle": [
      "Ого, орёл нырнул так низко!",
      "Слишком близко, птица. Слишком близко.",
      "Что-то большое только что пронеслось мимо меня.",
    ],
  },
  "dasha-study": {
    "animal.squirrel": [
      "Белочка! Привет, пушистая!",
      "Посмотри на её хвост!",
      "Ой, белка! Хочу погладить.",
    ],
    "animal.cat": [
      "Котик! Иди сюда.",
      "Кошка! Игнорирует меня. Невежливо.",
      "Ой, какие усы!",
    ],
    "animal.dog": [
      "Пёсик! Кто тут хороший?",
      "Смотри, собака! Можно поздороваться?",
      "У этого пёсика хвост не останавливается.",
    ],
    "animal.piranha": [
      "Рыбки! С зубами! Ой.",
      "Это пираньи? Здесь?",
      "Пальцы туда не сую.",
    ],
    "animal.eagle": [
      "Орёл! Какой большой!",
      "Смотри наверх! Орёл!",
      "Ого, он просто парит.",
    ],
    "animal.startled.dog": [
      "Ой! Он на меня гавкнул!",
      "Ай! Слишком большой и громкий!",
      "Ой! Я аж испугалась.",
    ],
    "animal.startled.eagle": [
      "Ой! Он летел прямо на меня!",
      "Ай! Птицы вблизи страшные.",
      "Ой-ой, он пикирует!",
    ],
  },
  "kai-study": {
    "animal.squirrel": [
      "Белка. Живёт на полную.",
      "Белка замечена. Очень занята, судя по всему.",
      "Одна (1) белка. Богата орехами.",
    ],
    "animal.cat": [
      "Кот. Имеет обо мне мнение.",
      "Кот решил, что я ниже его достоинства.",
      "Кот. Оценивает, как всегда.",
    ],
    "animal.dog": [
      "Пёс. Рад самому факту существования.",
      "Обнаружен пёс. Хвост на полной скорости.",
      "Пёс. Уровень энтузиазма: высокий.",
    ],
    "animal.piranha": [
      "Пираньи. Ну конечно, пираньи.",
      "Рыба с зубами. Маленькая шутка природы.",
      "Руку туда не суну. И ничего другого.",
    ],
    "animal.eagle": [
      "Орёл. Красуется, если честно.",
      "Птица. Большая. Мной не впечатлена.",
      "Орёл. В воздухе, в отличие от меня.",
    ],
    "animal.startled.dog": [
      "Это был лай. Никаких вздрагиваний. Почти.",
      "Громкий пёс. Принято к сведению, с тревогой.",
      "Так. Этого пса слишком много.",
    ],
    "animal.startled.eagle": [
      "Эта птица пролетела очень близко к лицу.",
      "Орёл на уровне глаз. Не идеально.",
      "Личное пространство, птица.",
    ],
  },
  "dasha-v2-study": {
    "animal.squirrel": [
      "Белка. Обожаю этот хвост.",
      "У этой белки причёска лучше моей.",
      "Беличий шик.",
    ],
    "animal.cat": [
      "Кот. Какая элегантность.",
      "Этот кот — целая эстетика.",
      "Котик, ты настоящее настроение.",
    ],
    "animal.dog": [
      "Пёсик! Осторожно с нарядом, солнышко.",
      "Милый пёсик. Лапки прочь от ткани.",
      "У этого щенка есть стиль.",
    ],
    "animal.piranha": [
      "Пираньи. Не мой аксессуар.",
      "Зубы в воде. Решительно нет.",
      "Не буду мочить платье рядом с ними.",
    ],
    "animal.eagle": [
      "Орёл. Какой силуэт.",
      "Какой размах крыльев. Культово.",
      "Этот орёл владеет небом.",
    ],
    "animal.startled.dog": [
      "Ай! Только не туфли!",
      "Ой, я аж подпрыгнула!",
      "Сидеть, милый, сидеть!",
    ],
    "animal.startled.eagle": [
      "Ай! Осторожно, причёска!",
      "Ой, он чуть меня не схватил!",
      "Слишком близко, птица. Это от кутюр.",
    ],
  },
};

export const AVAIA_ANIMAL_LINES: Readonly<
  Record<ProductLocale, Readonly<Record<AvatarModelId, AnimalVoice>>>
> = {
  en: EN,
  "uk-UA": UK,
  "ru-RU": RU,
};
