// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { GUIDE_EN, GUIDE_UK } from "./messages/guide";
import { IDENTITY_EN, IDENTITY_UK } from "./messages/identity";
import { RU_MESSAGES } from "./messages/russian";
import { WORLD_EN, WORLD_UK } from "./messages/world";

/** A real language locale the product can render today. */
export type ProductLocale = "en" | "uk-UA" | "ru-RU";

/** `auto` follows available host/device language evidence; an explicit locale is local UI state. */
export type LocalePreference = ProductLocale | "auto";

export const LOCALE_STORAGE_KEY = "nilx-one.interface.locale";
export const DEFAULT_LOCALE: ProductLocale = "en";
export const SUPPORTED_LOCALES: readonly ProductLocale[] = [
  "en",
  "uk-UA",
  "ru-RU",
];

const EN_MESSAGES = {
  "failure.region": "Failure notices",
  "failure.retry": "Try again",
  "failure.unavailable.title": "Request unanswered",
  "failure.unavailable.description":
    "Nothing could answer this request, so nothing was decided and nothing was substituted.",
  "failure.withheld.title": "Declined by authority",
  "failure.withheld.description":
    "Authority was asked and the answer was no; this is a decision, not a malfunction.",
  "failure.gated.title": "Not acting right now",
  "failure.gated.description":
    "The runtime is dormant or winding down, so it is not acting in its current mode.",
  "failure.rejected.title": "Request rejected",
  "failure.rejected.description":
    "The request contradicted the contract and was refused; an operator needs to look at this.",
  "failure.exhausted.title": "Limit reached",
  "failure.exhausted.description":
    "A counter for this operation hit its ceiling; an operator needs to look at this.",
  "header.world": "0x1 world",
  "header.navigation": "0x1 navigation",
  "header.settings": "Settings",
  "header.more": "More",
  "location.unsupported.label": "Location unavailable on this host",
  "location.unsupported.hint": "This host provides no device location.",
  "location.denied.label": "Location permission denied",
  "location.denied.hint":
    "Location is blocked for this site in your browser settings.",
  "location.enable.label": "Enable location",
  "location.enable.hint": "Show this device on the map.",
  "location.locating.label": "Locating this device",
  "location.locating.hint": "Waiting for a position from this device.",
  "location.unavailable.retryLabel": "Location unavailable, try again",
  "location.unavailable.recenterLabel": "Recenter on the last known position",
  "location.unavailable.timeoutHint": "This device did not answer in time.",
  "location.unavailable.positionHint":
    "This device could not resolve a position.",
  "location.centered.label": "Map centred on this device",
  "location.recenter.label": "Recenter on this device",
  "location.accuracy.approx": "Accuracy about",
  "map.card.thisDevice": "This device",
  "map.card.fromThisDevice": "{distance} from this device",
  "map.card.declared": "Manual position",
  "map.card.fromDeclared": "{distance} from the manual position",
  "landmark.pinned.motherland": "Motherland Monument",
  "landmark.pinned.lavra": "Kyiv Pechersk Lavra",
  "landmark.pinned.sophia": "Saint Sophia Cathedral",
  "landmark.pinned.independence": "Independence Monument",
  "landmark.pinned.standrew": "St Andrew's Church",
  "landmark.pinned.goldenGate": "Golden Gate",
  "landmark.pinned.trukhaniv": "Trukhaniv Island",
  "landmark.pinned.volodymyrHill": "Volodymyr Hill",
  "landmark.pinned.holosiiv": "Holosiiv Forest",
  "landmark.pinned.freedomArch": "Arch of Freedom",
  "landmark.pinned.askold": "Askold's Grave",
  "landmark.pinnedKind.monument": "Monument",
  "landmark.pinnedKind.sacred": "Sacred place",
  "landmark.pinnedKind.civic": "Square",
  "landmark.pinnedKind.nature": "Green space",
  "fog.prompt.title": "Reveal this patch of fog?",
  "fog.prompt.detail":
    "{avaia} will go there and reveal it in about {minutes} min.",
  "fog.prompt.landmarks":
    "Landmarks here: {count}. Each one takes longer to look over.",
  "fog.prompt.busy":
    "{avaia} is already revealing {limit} cells. Wait for one to clear.",
  "fog.prompt.confirm": "Reveal",
  "fog.prompt.cancel": "Not now",
  "fog.status.revealing": "Revealing {count} of {limit}",
  "fog.status.next": "next in {time}",
  "fog.announce.revealed": "A patch of fog was revealed.",
  "avaia.progression.title": "Progress",
  "avaia.progression.summary": "Level {level} · {xp} xp",
  "progression.summaryNext": "Level {level} · {xp} of {next} xp",
  "avaia.progression.unconfigured": "Level 0 · save the setup to reach level 1",
  "achievement.avaiaConfigured": "Avaia configured",
  "achievement.avaiaModelDownloaded": "Avaia model downloaded",
  "achievement.bondXp": "+{xp} Bond experience",
  "achievement.avaiaXp": "+{xp} Avaia experience",
  "achievement.level": "{name} reached level {level}",
  "achievement.nextDownload":
    "Next: download the model in Settings — once per device.",
  "achievement.continue": "OK",
  "header.attention": "A next step is waiting in Settings",
  "settings.localModel.reward":
    "Pays once on this device: +{bond} Bond and +{avaia} Avaia experience.",
  "avaia.notebook.title": "Landmarks studied",
  "avaia.notebook.empty":
    "Nothing yet. Walk past a monument, then hand your Avaia the wheel.",
  "avaia.notebook.note":
    "Kept on this device only. Nothing here is sent anywhere or asserted about anyone.",
  "settings.language.legend": "Language",
  "settings.language.auto": "Auto",
  "settings.language.autoAction": "Use detected language",
  "settings.language.detected.en": "Detected: English",
  "settings.language.detected.uk": "Detected: Ukrainian",
  "settings.language.english": "English",
  "settings.language.ukrainian": "Українська",
  "settings.language.russian": "Русский",
  "settings.language.detected.ru": "Detected: Russian",
  "settings.localModel.legend": "On-device model",
  "settings.localModel.choose": "Choose a model",
  "settings.localModel.status.checking": "Checking this device…",
  "settings.localModel.status.unsupportedInsecure":
    "Unavailable: this page is not loaded securely.",
  "settings.localModel.status.unsupportedNoWebgpu":
    "Unavailable: this browser has no WebGPU.",
  "settings.localModel.status.unsupportedNoAdapter":
    "Unavailable: no graphics adapter answered.",
  "settings.localModel.status.unsupportedBelowFloor":
    "Unavailable: this device is short of what the model runtime requires.",
  "settings.localModel.status.unsupportedFeatures":
    "Unavailable: this graphics adapter lacks a feature the model needs.",
  "settings.localModel.status.absent": "Not downloaded yet.",
  "settings.localModel.status.downloading": "Downloading…",
  "settings.localModel.status.present": "Downloaded and cached on this device.",
  "settings.localModel.status.removing": "Removing…",
  "settings.localModel.status.error": "Something went wrong.",
  "settings.localModel.detail.mirror": "From our own mirror,",
  "settings.localModel.detail.upstream": "From the model's upstream registry,",
  "settings.localModel.detail.unknownSize":
    "size unknown until the download starts.",
  "settings.localModel.action.download": "Download now",
  "settings.localModel.action.remove": "Remove downloaded model",
  "settings.localModel.action.cancel": "Cancel download",
  "settings.localModel.notices.legend": "Redistribution notices",
  "settings.localModel.option.default": "default",
  "settings.localModel.option.memory": "about {size} MB of memory",
  "settings.localModel.option.unavailable": "not available here",
  "settings.localModel.option.missingFeatures":
    "Not offered here: this device lacks a GPU feature the model needs.",
  "settings.localModel.option.overBudget":
    "Not offered here: needs about {required} MB, this surface allows {budget} MB.",
  "settings.localModel.option.unmeasured":
    "Ukrainian phrasing not yet measured on a device.",
  "settings.localModel.option.lowFaithfulness":
    "Rarely passes the faithfulness check: most sentences keep their plain wording.",
  "settings.localModel.option.usePolicy": "Acceptable use policy",
  "settings.localModel.option.usePolicyNote":
    "Built with Llama. Usage is subject to Meta's",
  "settings.localModel.option.usePolicyDismiss": "Dismiss",
  "settings.localModel.fallback.ineligible":
    "The model you chose can’t run here, so the default is used. Your choice is kept.",
  "settings.localModel.fallback.unknown":
    "The model you chose is no longer offered, so the default is used.",
  "settings.localModel.status.unsupportedOverBudget":
    "Unavailable: this model needs more memory than this surface allows.",
  "dock.edit": "edit",
  "dock.ai": "AI",
  "dock.unconfigured": "unconfigured",
  "dock.configured": "configured",
  "dock.notRead": "not read",
  "dock.ownedAvaia": "Owned Avaia",
  "dock.personalBond": "Personal Bond",
  "dock.providers": "Providers",
  "dock.connected": "Connected",
  "dock.notConnected": "Not connected",
  "dock.open": "Open",
  "dock.providerDescription":
    "A provider account is an identity this Bond points at, one account per provider. Disconnecting detaches it from this Bond; it never deletes the account on the provider.",
  "dock.model": "Model",
  "dock.threeDModel": "3D model",
  "dock.fixed": "fixed",
  "dock.cancel": "Cancel",
  "dock.save": "Save",
  "dock.saving": "Saving…",
  "dock.create": "Create",
  "dock.creating": "Creating…",
  "dock.caseSensitiveAvaia":
    "Case-sensitive · the owner discriminator and ai suffix are fixed by 0x1.",
  "dock.caseSensitiveBond":
    "Case-sensitive · the address is part of the Bond identity.",
  "dock.studies":
    "The studies share one skeleton and one set of clips; choosing changes the body, not how it moves.",
  "header.signOut": "Sign out",
  "shell.worldStatus": "World status",
  "settings.application": "Application",
  "settings.back": "Back",
  "settings.appearance.legend": "Appearance",
  "settings.appearance.light": "Light",
  "settings.appearance.lightDetail": "Keep the map light",
  "settings.appearance.dark": "Dark",
  "settings.appearance.darkDetail": "Keep the map dark",
  "settings.appearance.auto": "Auto",
  "settings.appearance.autoDetail": "Follow this device",
  "settings.depth.legend": "Depth",
  "settings.depth.threeD": "3D",
  "settings.depth.threeDDetail": "Raise buildings at close zoom",
  "settings.depth.twoD": "2D",
  "settings.depth.twoDDetail": "Keep buildings as footprints",
  "settings.presentation":
    "This is local interface presentation state. It does not change Bond, BondChain, or shared Core state.",
  "settings.localModel.bytes": "{size} MB",
  "runtime.loading": "Loading shared Core",
  "runtime.ready": "Shared Core ready",
  "runtime.required": "Shared Core required",
  "runtime.contract": "contract {version}",
  "host.browser": "browser host",
  "host.browserUnavailable": "browser unavailable",
  "host.telegram": "telegram host",
  "host.telegramUnavailable": "telegram unavailable",
  "host.discord": "discord host",
  "host.discordUnavailable": "discord unavailable",
  "host.native": "native host",
  "host.nativeUnavailable": "native unavailable",
  "dock.you": "You",
  "dock.spectate": "spectate",
  "dock.driving": "driving",
  "dock.ready": "ready",
  "dock.preparing": "preparing",
  "dock.download": "download",
  "dock.unavailable": "unavailable",
  "dock.noRelationship": "No reciprocal relationship asserted",
  "dock.focusWorld": "Focus the world on {name}",
  "dock.takeWheel": "Take the wheel as {name}",
  "dock.handWheel": "Hand the wheel to {name}",
  "dock.setUp": "Set up {name}",
  "dock.editNamed": "Edit {name}",
  "dock.noStudy": "No study chosen yet — no avatar is drawn until you choose.",
  "dock.unsupportedStudy":
    "This Bond chose {model}, which this client cannot display. Update 0x1 to render that choice.",
  "dock.addProvider": "Add a provider",
  "dock.loading": "Loading…",
  "dock.loadingProviders": "Loading provider connections…",
  "dock.connect": "Connect",
  "dock.avaiaSaved": "Avaia saved",
  "dock.saveChoiceFailed": "Couldn’t save this choice. Try again.",
  ...IDENTITY_EN,
  ...WORLD_EN,
  ...GUIDE_EN,
} as const;

export type TranslationKey = keyof typeof EN_MESSAGES;
export type Translate = (key: TranslationKey) => string;

export const HOST_LABEL_KEYS = [
  "host.browser",
  "host.browserUnavailable",
  "host.telegram",
  "host.telegramUnavailable",
  "host.discord",
  "host.discordUnavailable",
  "host.native",
  "host.nativeUnavailable",
] as const satisfies readonly TranslationKey[];

export const RUNTIME_LABEL_KEYS = [
  "runtime.loading",
  "runtime.ready",
  "runtime.required",
] as const satisfies readonly TranslationKey[];

export const DOCK_ROLE_KEYS = [
  "dock.you",
  "dock.spectate",
  "dock.driving",
  "dock.ready",
  "dock.preparing",
  "dock.download",
  "dock.unavailable",
  "dock.unconfigured",
] as const satisfies readonly TranslationKey[];

export const DOCK_ACTION_KEYS = [
  "dock.focusWorld",
  "dock.takeWheel",
  "dock.handWheel",
  "dock.setUp",
  "dock.editNamed",
] as const satisfies readonly TranslationKey[];

const UK_MESSAGES: Readonly<Record<TranslationKey, string>> = {
  "failure.region": "Сповіщення про помилки",
  "failure.retry": "Спробувати знову",
  "failure.unavailable.title": "Запит без відповіді",
  "failure.unavailable.description":
    "На цей запит не вдалося отримати відповідь, тому нічого не було вирішено й нічим не підмінено.",
  "failure.withheld.title": "Рішення: відмова",
  "failure.withheld.description":
    "Повноважний компонент отримав запит і відповів «ні»; це рішення, а не збій.",
  "failure.gated.title": "Зараз не виконується",
  "failure.gated.description":
    "Runtime неактивний або завершує роботу, тому зараз не діє у поточному режимі.",
  "failure.rejected.title": "Запит відхилено",
  "failure.rejected.description":
    "Запит суперечить контракту й був відхилений; це потребує уваги оператора.",
  "failure.exhausted.title": "Ліміт вичерпано",
  "failure.exhausted.description":
    "Лічильник цієї операції досяг межі; це потребує уваги оператора.",
  "header.world": "Світ 0x1",
  "header.navigation": "Навігація 0x1",
  "header.settings": "Налаштування",
  "header.more": "Більше",
  "location.unsupported.label": "Геолокація недоступна в цьому хості",
  "location.unsupported.hint": "Цей хост не надає геолокацію пристрою.",
  "location.denied.label": "Доступ до геолокації заборонено",
  "location.denied.hint":
    "Геолокацію заблоковано для цього сайту в налаштуваннях браузера.",
  "location.enable.label": "Увімкнути геолокацію",
  "location.enable.hint": "Показати цей пристрій на мапі.",
  "location.locating.label": "Визначаємо місцезнаходження",
  "location.locating.hint": "Очікуємо координати від цього пристрою.",
  "location.unavailable.retryLabel":
    "Геолокація недоступна — спробувати ще раз",
  "location.unavailable.recenterLabel":
    "Повернутися до останньої відомої позиції",
  "location.unavailable.timeoutHint": "Пристрій не відповів вчасно.",
  "location.unavailable.positionHint": "Пристрою не вдалося визначити позицію.",
  "location.centered.label": "Мапа центрована на цьому пристрої",
  "location.recenter.label": "Центрувати на цьому пристрої",
  "location.accuracy.approx": "Точність близько",
  "map.card.thisDevice": "Цей пристрій",
  "map.card.fromThisDevice": "{distance} від цього пристрою",
  "map.card.declared": "Ручна позиція",
  "map.card.fromDeclared": "{distance} від ручної позиції",
  "landmark.pinned.motherland": "Батьківщина-Мати",
  "landmark.pinned.lavra": "Києво-Печерська лавра",
  "landmark.pinned.sophia": "Софія Київська",
  "landmark.pinned.independence": "Монумент Незалежності",
  "landmark.pinned.standrew": "Андріївська церква",
  "landmark.pinned.goldenGate": "Золоті ворота",
  "landmark.pinned.trukhaniv": "Труханів острів",
  "landmark.pinned.volodymyrHill": "Володимирська гірка",
  "landmark.pinned.holosiiv": "Голосіївський ліс",
  "landmark.pinned.freedomArch": "Арка Свободи",
  "landmark.pinned.askold": "Аскольдова могила",
  "landmark.pinnedKind.monument": "Пам'ятка",
  "landmark.pinnedKind.sacred": "Святиня",
  "landmark.pinnedKind.civic": "Площа",
  "landmark.pinnedKind.nature": "Зелена зона",
  "fog.prompt.title": "Відкрити цю клітинку туману?",
  "fog.prompt.detail":
    "{avaia} піде туди й відкриє її приблизно за {minutes} хв.",
  "fog.prompt.landmarks": "Пам’яток тут: {count}. Кожна додає часу на огляд.",
  "fog.prompt.busy":
    "{avaia} вже відкриває {limit} клітинки. Зачекайте, поки одна відкриється.",
  "fog.prompt.confirm": "Відкрити",
  "fog.prompt.cancel": "Не зараз",
  "fog.status.revealing": "Відкривається {count} з {limit}",
  "fog.status.next": "наступна за {time}",
  "fog.announce.revealed": "Клітинку туману відкрито.",
  "avaia.progression.title": "Прокачка",
  "avaia.progression.summary": "Рівень {level} · {xp} досвіду",
  "progression.summaryNext": "Рівень {level} · {xp} з {next} досвіду",
  "avaia.progression.unconfigured":
    "Рівень 0 · збережіть налаштування, щоб отримати рівень 1",
  "achievement.avaiaConfigured": "Avaia налаштовано",
  "achievement.avaiaModelDownloaded": "Модель Avaia завантажено",
  "achievement.bondXp": "+{xp} досвіду Bond",
  "achievement.avaiaXp": "+{xp} досвіду Avaia",
  "achievement.level": "{name} досягає рівня {level}",
  "achievement.nextDownload":
    "Далі: завантажте модель у налаштуваннях — один раз на пристрій.",
  "achievement.continue": "Гаразд",
  "header.attention": "У налаштуваннях чекає наступний крок",
  "settings.localModel.reward":
    "Один раз на цьому пристрої: +{bond} досвіду Bond і +{avaia} досвіду Avaia.",
  "avaia.notebook.title": "Вивчені пам’ятки",
  "avaia.notebook.empty":
    "Поки нічого. Пройдіть повз пам’ятник, а потім передайте кермо своїй Avaia.",
  "avaia.notebook.note":
    "Зберігається лише на цьому пристрої. Нічого звідси нікуди не надсилається і ні про кого не стверджується.",
  "settings.language.legend": "Мова",
  "settings.language.auto": "Автоматично",
  "settings.language.autoAction": "Використовувати визначену мову",
  "settings.language.detected.en": "Визначено: English",
  "settings.language.detected.uk": "Визначено: Українська",
  "settings.language.english": "English",
  "settings.language.ukrainian": "Українська",
  "settings.language.russian": "Русский",
  "settings.language.detected.ru": "Визначено: Русский",
  "settings.localModel.legend": "Локальна модель",
  "settings.localModel.choose": "Оберіть модель",
  "settings.localModel.status.checking": "Перевіряємо цей пристрій…",
  "settings.localModel.status.unsupportedInsecure":
    "Недоступно: сторінку завантажено не безпечно.",
  "settings.localModel.status.unsupportedNoWebgpu":
    "Недоступно: у цьому браузері немає WebGPU.",
  "settings.localModel.status.unsupportedNoAdapter":
    "Недоступно: жоден графічний адаптер не відповів.",
  "settings.localModel.status.unsupportedBelowFloor":
    "Недоступно: цьому пристрою не вистачає того, що вимагає рантайм моделі.",
  "settings.localModel.status.unsupportedFeatures":
    "Недоступно: графічному адаптеру бракує можливості, потрібної моделі.",
  "settings.localModel.status.absent": "Ще не завантажено.",
  "settings.localModel.status.downloading": "Завантажуємо…",
  "settings.localModel.status.present":
    "Завантажено і закешовано на цьому пристрої.",
  "settings.localModel.status.removing": "Видаляємо…",
  "settings.localModel.status.error": "Щось пішло не так.",
  "settings.localModel.detail.mirror": "З нашого власного мірора,",
  "settings.localModel.detail.upstream": "Зі сховища виробника моделі,",
  "settings.localModel.detail.unknownSize":
    "розмір невідомий, доки не почнеться завантаження.",
  "settings.localModel.action.download": "Завантажити зараз",
  "settings.localModel.action.remove": "Видалити завантажену модель",
  "settings.localModel.action.cancel": "Скасувати завантаження",
  "settings.localModel.notices.legend": "Примітки щодо розповсюдження",
  "settings.localModel.option.default": "типова",
  "settings.localModel.option.memory": "близько {size} МБ пам’яті",
  "settings.localModel.option.unavailable": "тут недоступна",
  "settings.localModel.option.missingFeatures":
    "Тут недоступна: цьому пристрою бракує можливості GPU, потрібної моделі.",
  "settings.localModel.option.overBudget":
    "Тут недоступна: потрібно близько {required} МБ, а тут дозволено {budget} МБ.",
  "settings.localModel.option.unmeasured":
    "Якість українських формулювань ще не виміряна на пристрої.",
  "settings.localModel.option.lowFaithfulness":
    "Рідко проходить перевірку точності: більшість речень лишаються простими.",
  "settings.localModel.option.usePolicy": "Політика допустимого використання",
  "settings.localModel.option.usePolicyNote":
    "Побудовано на Llama. Використання підпорядковується",
  "settings.localModel.option.usePolicyDismiss": "Закрити",
  "settings.localModel.fallback.ineligible":
    "Обрана модель тут не запускається, тож працює типова. Ваш вибір збережено.",
  "settings.localModel.fallback.unknown":
    "Обрану модель більше не пропонують, тож працює типова.",
  "settings.localModel.status.unsupportedOverBudget":
    "Недоступно: цій моделі потрібно більше пам’яті, ніж дозволено тут.",
  "dock.edit": "змінити",
  "dock.ai": "ШІ",
  "dock.unconfigured": "не налаштовано",
  "dock.configured": "налаштовано",
  "dock.notRead": "не прочитано",
  "dock.ownedAvaia": "Власна Avaia",
  "dock.personalBond": "Особистий Bond",
  "dock.providers": "Провайдери",
  "dock.connected": "Підключено",
  "dock.notConnected": "Не підключено",
  "dock.open": "Відкрити",
  "dock.providerDescription":
    "Обліковий запис провайдера — це ідентичність, на яку вказує цей Bond; по одному обліковому запису на провайдера. Від’єднання від’єднує його від цього Bond і ніколи не видаляє обліковий запис у провайдера.",
  "dock.model": "Модель",
  "dock.threeDModel": "3D модель",
  "dock.fixed": "не змінюється",
  "dock.cancel": "Скасувати",
  "dock.save": "Зберегти",
  "dock.saving": "Зберігаємо…",
  "dock.create": "Створити",
  "dock.creating": "Створюємо…",
  "dock.caseSensitiveAvaia":
    "З урахуванням регістру · дискримінатор власника та суфікс ai фіксуються 0x1.",
  "dock.caseSensitiveBond":
    "З урахуванням регістру · адреса є частиною ідентичності Bond.",
  "dock.studies":
    "Дослідження використовують один скелет і один набір кліпів; вибір змінює тіло, а не спосіб його руху.",
  "header.signOut": "Вийти",
  "shell.worldStatus": "Стан світу",
  "settings.application": "Застосунок",
  "settings.back": "Назад",
  "settings.appearance.legend": "Вигляд",
  "settings.appearance.light": "Світлий",
  "settings.appearance.lightDetail": "Залишити мапу світлою",
  "settings.appearance.dark": "Темний",
  "settings.appearance.darkDetail": "Залишити мапу темною",
  "settings.appearance.auto": "Автоматично",
  "settings.appearance.autoDetail": "Як на цьому пристрої",
  "settings.depth.legend": "Глибина",
  "settings.depth.threeD": "3D",
  "settings.depth.threeDDetail": "Піднімати будівлі при наближенні",
  "settings.depth.twoD": "2D",
  "settings.depth.twoDDetail": "Залишати будівлі контурами",
  "settings.presentation":
    "Це локальний стан показу інтерфейсу. Він не змінює стан Bond, BondChain чи спільного Core.",
  "settings.localModel.bytes": "{size} МБ",
  "runtime.loading": "Завантаження спільного Core",
  "runtime.ready": "Спільний Core готовий",
  "runtime.required": "Потрібен спільний Core",
  "runtime.contract": "контракт {version}",
  "host.browser": "хост браузера",
  "host.browserUnavailable": "браузер недоступний",
  "host.telegram": "хост Telegram",
  "host.telegramUnavailable": "Telegram недоступний",
  "host.discord": "хост Discord",
  "host.discordUnavailable": "Discord недоступний",
  "host.native": "нативний хост",
  "host.nativeUnavailable": "нативний хост недоступний",
  "dock.you": "Ви",
  "dock.spectate": "спостерігає",
  "dock.driving": "за кермом",
  "dock.ready": "готово",
  "dock.preparing": "готується",
  "dock.download": "завантажити",
  "dock.unavailable": "недоступно",
  "dock.noRelationship": "Взаємний зв’язок не стверджується",
  "dock.focusWorld": "Сфокусувати світ на {name}",
  "dock.takeWheel": "Сісти за кермо як {name}",
  "dock.handWheel": "Передати кермо {name}",
  "dock.setUp": "Налаштувати {name}",
  "dock.editNamed": "Змінити {name}",
  "dock.noStudy":
    "Дослідження ще не обрано — аватар не з’являється, доки ви не оберете.",
  "dock.unsupportedStudy":
    "Цей Bond обрав {model}, і цей клієнт не може це показати. Оновіть 0x1, щоб відобразити цей вибір.",
  "dock.addProvider": "Додати провайдера",
  "dock.loading": "Завантаження…",
  "dock.loadingProviders": "Завантаження підключень провайдерів…",
  "dock.connect": "Підключити",
  "dock.avaiaSaved": "Avaia збережено",
  "dock.saveChoiceFailed": "Не вдалося зберегти цей вибір. Спробуйте ще раз.",
  ...IDENTITY_UK,
  ...WORLD_UK,
  ...GUIDE_UK,
};

const CATALOGS: Readonly<
  Record<ProductLocale, Readonly<Record<TranslationKey, string>>>
> = {
  en: EN_MESSAGES,
  "uk-UA": UK_MESSAGES,
  "ru-RU": RU_MESSAGES,
};

function languageOf(tag: string): string | undefined {
  return tag.trim().replaceAll("_", "-").toLowerCase().split("-")[0];
}

/**
 * Belarusian has no catalog of its own; it resolves to Ukrainian, while Russian
 * stays one explicit choice away.
 */
function supportedLocale(tag: string): ProductLocale | undefined {
  const language = languageOf(tag);
  if (language === "uk" || language === "be") return "uk-UA";
  if (language === "ru") return "ru-RU";
  if (language === "en") return "en";
  return undefined;
}

function firstSupportedLocale(
  languages: readonly string[],
): ProductLocale | undefined {
  for (const language of languages) {
    const locale = supportedLocale(language);
    if (locale !== undefined) return locale;
  }
  return undefined;
}

/**
 * Resolve from explicit local preference, then ordered host evidence, then
 * ordered browser/device languages, then English. Region subtags never change
 * the language family: every `uk-*` and `be-*` tag resolves to the Ukrainian
 * catalog, and every `ru-*` tag to the Russian one.
 */
export function resolveLocale(
  preference: LocalePreference,
  hostLanguages: readonly string[],
  deviceLanguages: readonly string[],
): ProductLocale {
  if (preference !== "auto") return preference;
  return (
    firstSupportedLocale(hostLanguages) ??
    firstSupportedLocale(deviceLanguages) ??
    DEFAULT_LOCALE
  );
}

const LOCALES_WITHOUT_RUSSIAN: readonly ProductLocale[] =
  SUPPORTED_LOCALES.filter((locale) => locale !== "ru-RU");

/**
 * Russian is offered only where the host or device already speaks Russian or
 * Belarusian, or where it is the standing choice; everyone else never sees it.
 */
export function offersRussian(
  preference: LocalePreference,
  hostLanguages: readonly string[],
  deviceLanguages: readonly string[],
): boolean {
  if (preference === "ru-RU") return true;
  return [...hostLanguages, ...deviceLanguages].some((tag) => {
    const language = languageOf(tag);
    return language === "ru" || language === "be";
  });
}

/** The locales a person may choose from, in the order they are offered. */
export function offeredLocales(
  preference: LocalePreference,
  hostLanguages: readonly string[],
  deviceLanguages: readonly string[],
): readonly ProductLocale[] {
  return offersRussian(preference, hostLanguages, deviceLanguages)
    ? SUPPORTED_LOCALES
    : LOCALES_WITHOUT_RUSSIAN;
}

export function translate(locale: ProductLocale, key: TranslationKey): string {
  return CATALOGS[locale][key];
}

/**
 * Present `value` in the active locale when it is still the English catalog
 * sentence for `key`. Any other wording — a view-model that has since changed
 * the copy — is shown as written.
 */
export function translateIf(
  t: Translate,
  key: TranslationKey,
  value: string,
): string {
  return value === translate("en", key) ? t(key) : value;
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

interface CompiledTemplate {
  readonly key: TranslationKey;
  readonly pattern: RegExp;
  readonly names: readonly string[];
  readonly literalLength: number;
}

const compiledTemplates = new Map<TranslationKey, CompiledTemplate | null>();

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTemplate(key: TranslationKey): CompiledTemplate | null {
  const cached = compiledTemplates.get(key);
  if (cached !== undefined) return cached;
  const english = translate("en", key);
  const names: string[] = [];
  const seen = new Map<string, number>();
  let source = "";
  let cursor = 0;
  let literalLength = 0;
  for (const match of english.matchAll(PLACEHOLDER)) {
    const literal = english.slice(cursor, match.index);
    source += escapePattern(literal);
    literalLength += literal.length;
    const name = match[1] ?? "";
    const group = seen.get(name);
    if (group === undefined) {
      names.push(name);
      seen.set(name, names.length);
      source += "(.+?)";
    } else {
      source += `\\${group}`;
    }
    cursor = match.index + match[0].length;
  }
  const tail = english.slice(cursor);
  literalLength += tail.length;
  const compiled =
    names.length === 0
      ? null
      : {
          key,
          pattern: new RegExp(`^${source}${escapePattern(tail)}$`, "s"),
          names,
          literalLength,
        };
  compiledTemplates.set(key, compiled);
  return compiled;
}

function fillTemplate(
  t: Translate,
  template: CompiledTemplate,
  value: string,
): string | undefined {
  const match = template.pattern.exec(value);
  if (match === null) return undefined;
  return template.names.reduce(
    (text, name, index) => text.replaceAll(`{${name}}`, match[index + 1] ?? ""),
    t(template.key),
  );
}

/**
 * Present `value` from the first catalog sentence among `keys` it still
 * matches. Exact sentences win over templates; `{placeholder}` templates are
 * tried from the most specific wording down, and their filled-in values are
 * carried into the translation unchanged. Anything else is shown as written.
 */
export function translateFirst(
  t: Translate,
  value: string,
  keys: readonly TranslationKey[],
): string {
  const templates: CompiledTemplate[] = [];
  for (const key of keys) {
    if (value === translate("en", key)) return t(key);
    const template = compileTemplate(key);
    if (template !== null) templates.push(template);
  }
  templates.sort((a, b) => b.literalLength - a.literalLength);
  for (const template of templates) {
    const filled = fillTemplate(t, template, value);
    if (filled !== undefined) return filled;
  }
  return value;
}

const COPY_KEYS = [
  "dock.saveChoiceFailed",
  ...Object.keys(IDENTITY_EN),
  ...Object.keys(WORLD_EN),
] as readonly TranslationKey[];

/**
 * Present view-model copy — statuses, errors, notes and details that arrive
 * as English sentences — in the active locale.
 */
export function translateCopy(t: Translate, value: string): string {
  return translateFirst(t, value, COPY_KEYS);
}

let sessionPreference: LocalePreference | undefined;
let hostLanguageEvidence: readonly string[] = [];
const listeners = new Set<() => void>();
let deviceLanguageWatched = false;

function notify(): void {
  for (const listener of listeners) listener();
}

export function readLocalePreference(): LocalePreference {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (
      stored === "auto" ||
      stored === "en" ||
      stored === "uk-UA" ||
      stored === "ru-RU"
    ) {
      return stored;
    }
  } catch {
    // Storage is optional. The interface remains usable with detected language.
  }
  return "auto";
}

/** A person's standing language choice. It never enters Bond, BondChain, or Core state. */
export function chooseLocale(preference: LocalePreference): void {
  sessionPreference = preference;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // Persistence is best-effort only; the choice still applies this session.
  }
  notify();
}

/**
 * Supply ordered host language hints before the product mounts. These hints are
 * presentation evidence only: they must never be promoted to authentication or
 * protocol truth. An empty list removes host-specific evidence.
 */
export function declareHostLanguages(languages: readonly string[]): void {
  const next = languages.map((language) => language.trim()).filter(Boolean);
  if (
    next.length === hostLanguageEvidence.length &&
    next.every((language, index) => language === hostLanguageEvidence[index])
  ) {
    return;
  }
  hostLanguageEvidence = next;
  notify();
}

function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language.length > 0 ? [navigator.language] : [];
}

function currentAutoLocale(): ProductLocale {
  return resolveLocale("auto", hostLanguageEvidence, deviceLanguages());
}

function currentRussianOffered(): boolean {
  return offersRussian(
    readLocalePreference(),
    hostLanguageEvidence,
    deviceLanguages(),
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!deviceLanguageWatched && typeof window !== "undefined") {
    window.addEventListener("languagechange", notify);
    deviceLanguageWatched = true;
  }
  return () => listeners.delete(listener);
}

export interface LocalizationState {
  readonly preference: LocalePreference;
  readonly resolved: ProductLocale;
  readonly offered: readonly ProductLocale[];
  readonly t: Translate;
}

/** One frontend-owned locale store shared by every product host. */
export function useLocalization(): LocalizationState {
  const preference = useSyncExternalStore(
    subscribe,
    readLocalePreference,
    () => "auto" as LocalePreference,
  );
  const autoLocale = useSyncExternalStore(
    subscribe,
    currentAutoLocale,
    () => DEFAULT_LOCALE,
  );
  const russianOffered = useSyncExternalStore(
    subscribe,
    currentRussianOffered,
    () => false,
  );
  const resolved = preference === "auto" ? autoLocale : preference;
  const offered = russianOffered ? SUPPORTED_LOCALES : LOCALES_WITHOUT_RUSSIAN;
  const t = useCallback<Translate>(
    (key) => translate(resolved, key),
    [resolved],
  );

  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);

  return { preference, resolved, offered, t };
}
