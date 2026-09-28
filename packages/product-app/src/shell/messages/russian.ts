// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { TranslationKey } from "../localization";
import { GUIDE_RU } from "./guide";

/**
 * The Russian catalog. It is only ever offered to hosts and devices that speak
 * Russian or Belarusian; see `offersRussian`.
 */
export const RU_MESSAGES: Readonly<Record<TranslationKey, string>> = {
  "failure.region": "Уведомления об ошибках",
  "failure.retry": "Попробовать снова",
  "failure.unavailable.title": "Запрос без ответа",
  "failure.unavailable.description":
    "На этот запрос не удалось получить ответ, поэтому ничего не было решено и ничем не подменено.",
  "failure.withheld.title": "Решение: отказ",
  "failure.withheld.description":
    "Полномочный компонент получил запрос и ответил «нет»; это решение, а не сбой.",
  "failure.gated.title": "Сейчас не выполняется",
  "failure.gated.description":
    "Runtime неактивен или завершает работу, поэтому сейчас не действует в текущем режиме.",
  "failure.rejected.title": "Запрос отклонён",
  "failure.rejected.description":
    "Запрос противоречит контракту и был отклонён; это требует внимания оператора.",
  "failure.exhausted.title": "Лимит исчерпан",
  "failure.exhausted.description":
    "Счётчик этой операции достиг предела; это требует внимания оператора.",
  "header.world": "Мир 0x1",
  "header.navigation": "Навигация 0x1",
  "header.settings": "Настройки",
  "header.more": "Ещё",
  "location.unsupported.label": "Геолокация недоступна на этом хосте",
  "location.unsupported.hint":
    "Этот хост не предоставляет геолокацию устройства.",
  "location.denied.label": "Доступ к геолокации запрещён",
  "location.denied.hint":
    "Геолокация заблокирована для этого сайта в настройках браузера.",
  "location.enable.label": "Включить геолокацию",
  "location.enable.hint": "Показать это устройство на карте.",
  "location.locating.label": "Определяем местоположение",
  "location.locating.hint": "Ожидаем координаты от этого устройства.",
  "location.unavailable.retryLabel":
    "Геолокация недоступна — попробовать ещё раз",
  "location.unavailable.recenterLabel":
    "Вернуться к последней известной позиции",
  "location.unavailable.timeoutHint": "Устройство не ответило вовремя.",
  "location.unavailable.positionHint":
    "Устройству не удалось определить позицию.",
  "location.centered.label": "Карта центрирована на этом устройстве",
  "location.recenter.label": "Центрировать на этом устройстве",
  "location.accuracy.approx": "Точность около",
  "map.card.thisDevice": "Это устройство",
  "map.card.fromThisDevice": "{distance} от этого устройства",
  "map.card.declared": "Ручная позиция",
  "map.card.fromDeclared": "{distance} от ручной позиции",
  "landmark.pinned.motherland": "Родина-мать",
  "landmark.pinned.lavra": "Киево-Печерская лавра",
  "landmark.pinned.sophia": "Софийский собор",
  "landmark.pinned.independence": "Монумент Независимости",
  "landmark.pinned.standrew": "Андреевская церковь",
  "landmark.pinned.goldenGate": "Золотые ворота",
  "landmark.pinned.trukhaniv": "Труханов остров",
  "landmark.pinned.volodymyrHill": "Владимирская горка",
  "landmark.pinned.holosiiv": "Голосеевский лес",
  "landmark.pinned.freedomArch": "Арка Свободы",
  "landmark.pinned.askold": "Аскольдова могила",
  "landmark.pinnedKind.monument": "Памятник",
  "landmark.pinnedKind.sacred": "Святыня",
  "landmark.pinnedKind.civic": "Площадь",
  "landmark.pinnedKind.nature": "Зелёная зона",
  "fog.prompt.title": "Открыть эту клетку тумана?",
  "fog.prompt.detail":
    "{avaia} отправится туда и откроет её примерно за {minutes} мин.",
  "fog.prompt.landmarks":
    "Достопримечательностей здесь: {count}. Каждая добавляет времени на осмотр.",
  "fog.prompt.busy":
    "{avaia} уже открывает клеток: {limit}. Подождите, пока одна откроется.",
  "fog.prompt.confirm": "Открыть",
  "fog.prompt.cancel": "Не сейчас",
  "fog.status.revealing": "Открывается {count} из {limit}",
  "fog.status.next": "следующая через {time}",
  "fog.announce.revealed": "Клетка тумана открыта.",
  "avaia.progression.title": "Прогресс",
  "avaia.progression.summary": "Уровень {level} · {xp} опыта",
  "progression.summaryNext": "Уровень {level} · {xp} из {next} опыта",
  "avaia.progression.unconfigured":
    "Уровень 0 · сохраните настройки, чтобы получить уровень 1",
  "achievement.avaiaConfigured": "Avaia настроена",
  "achievement.avaiaModelDownloaded": "Модель Avaia загружена",
  "achievement.bondXp": "+{xp} опыта Bond",
  "achievement.avaiaXp": "+{xp} опыта Avaia",
  "achievement.level": "{name} достигает уровня {level}",
  "achievement.nextDownload":
    "Дальше: загрузите модель в настройках — один раз на устройство.",
  "achievement.continue": "Хорошо",
  "header.attention": "В настройках ждёт следующий шаг",
  "settings.localModel.reward":
    "Один раз на этом устройстве: +{bond} опыта Bond и +{avaia} опыта Avaia.",
  "avaia.notebook.title": "Изученные достопримечательности",
  "avaia.notebook.empty":
    "Пока ничего. Пройдите мимо памятника, а потом передайте руль своей Avaia.",
  "avaia.notebook.note":
    "Хранится только на этом устройстве. Ничего отсюда никуда не отправляется и ни о ком не утверждается.",
  "settings.language.legend": "Язык",
  "settings.language.auto": "Автоматически",
  "settings.language.autoAction": "Использовать определённый язык",
  "settings.language.detected.en": "Определено: English",
  "settings.language.detected.uk": "Определено: Українська",
  "settings.language.english": "English",
  "settings.language.ukrainian": "Українська",
  "settings.language.russian": "Русский",
  "settings.language.detected.ru": "Определено: Русский",
  "settings.localModel.legend": "Локальная модель",
  "settings.localModel.choose": "Выберите модель",
  "settings.localModel.status.checking": "Проверяем это устройство…",
  "settings.localModel.status.unsupportedInsecure":
    "Недоступно: страница загружена небезопасно.",
  "settings.localModel.status.unsupportedNoWebgpu":
    "Недоступно: в этом браузере нет WebGPU.",
  "settings.localModel.status.unsupportedNoAdapter":
    "Недоступно: ни один графический адаптер не ответил.",
  "settings.localModel.status.unsupportedBelowFloor":
    "Недоступно: этому устройству не хватает того, что требует рантайм модели.",
  "settings.localModel.status.unsupportedFeatures":
    "Недоступно: графическому адаптеру не хватает возможности, нужной модели.",
  "settings.localModel.status.absent": "Ещё не загружено.",
  "settings.localModel.status.downloading": "Загружаем…",
  "settings.localModel.status.present":
    "Загружено и закешировано на этом устройстве.",
  "settings.localModel.status.removing": "Удаляем…",
  "settings.localModel.status.error": "Что-то пошло не так.",
  "settings.localModel.detail.mirror": "С нашего собственного зеркала,",
  "settings.localModel.detail.upstream": "Из хранилища разработчика модели,",
  "settings.localModel.detail.unknownSize":
    "размер неизвестен, пока не начнётся загрузка.",
  "settings.localModel.action.download": "Загрузить сейчас",
  "settings.localModel.action.remove": "Удалить загруженную модель",
  "settings.localModel.action.cancel": "Отменить загрузку",
  "settings.localModel.notices.legend": "Примечания о распространении",
  "settings.localModel.option.default": "по умолчанию",
  "settings.localModel.option.memory": "около {size} МБ памяти",
  "settings.localModel.option.unavailable": "здесь недоступна",
  "settings.localModel.option.missingFeatures":
    "Здесь недоступна: этому устройству не хватает возможности GPU, нужной модели.",
  "settings.localModel.option.overBudget":
    "Здесь недоступна: нужно около {required} МБ, а здесь разрешено {budget} МБ.",
  "settings.localModel.option.unmeasured":
    "Качество украинских формулировок ещё не измерено на устройстве.",
  "settings.localModel.option.lowFaithfulness":
    "Редко проходит проверку точности: большинство предложений остаются простыми.",
  "settings.localModel.option.usePolicy": "Политика допустимого использования",
  "settings.localModel.option.usePolicyNote":
    "Построено на Llama. Использование регулируется",
  "settings.localModel.option.usePolicyDismiss": "Закрыть",
  "settings.localModel.fallback.ineligible":
    "Выбранная модель здесь не запускается, поэтому работает модель по умолчанию. Ваш выбор сохранён.",
  "settings.localModel.fallback.unknown":
    "Выбранную модель больше не предлагают, поэтому работает модель по умолчанию.",
  "settings.localModel.status.unsupportedOverBudget":
    "Недоступно: этой модели нужно больше памяти, чем разрешено здесь.",
  "dock.edit": "изменить",
  "dock.ai": "ИИ",
  "dock.unconfigured": "не настроено",
  "dock.configured": "настроено",
  "dock.notRead": "не прочитано",
  "dock.ownedAvaia": "Собственная Avaia",
  "dock.personalBond": "Личный Bond",
  "dock.providers": "Провайдеры",
  "dock.connected": "Подключено",
  "dock.notConnected": "Не подключено",
  "dock.open": "Открыть",
  "dock.providerDescription":
    "Аккаунт провайдера — это идентичность, на которую указывает этот Bond; по одному аккаунту на провайдера. Отключение отвязывает его от этого Bond и никогда не удаляет аккаунт у провайдера.",
  "dock.model": "Модель",
  "dock.threeDModel": "3D-модель",
  "dock.fixed": "не меняется",
  "dock.cancel": "Отмена",
  "dock.save": "Сохранить",
  "dock.saving": "Сохраняем…",
  "dock.create": "Создать",
  "dock.creating": "Создаём…",
  "dock.caseSensitiveAvaia":
    "С учётом регистра · дискриминатор владельца и суффикс ai задаёт 0x1.",
  "dock.caseSensitiveBond":
    "С учётом регистра · адрес является частью идентичности Bond.",
  "dock.studies":
    "Исследования используют один скелет и один набор клипов; выбор меняет тело, а не то, как оно двигается.",
  "header.signOut": "Выйти",
  "shell.worldStatus": "Состояние мира",
  "settings.application": "Приложение",
  "settings.back": "Назад",
  "settings.appearance.legend": "Внешний вид",
  "settings.appearance.light": "Светлая",
  "settings.appearance.lightDetail": "Оставить карту светлой",
  "settings.appearance.dark": "Тёмная",
  "settings.appearance.darkDetail": "Оставить карту тёмной",
  "settings.appearance.auto": "Автоматически",
  "settings.appearance.autoDetail": "Как на этом устройстве",
  "settings.depth.legend": "Глубина",
  "settings.depth.threeD": "3D",
  "settings.depth.threeDDetail": "Поднимать здания при приближении",
  "settings.depth.twoD": "2D",
  "settings.depth.twoDDetail": "Оставлять здания контурами",
  "settings.presentation":
    "Это локальное состояние отображения интерфейса. Оно не меняет состояние Bond, BondChain или общего Core.",
  "settings.localModel.bytes": "{size} МБ",
  "runtime.loading": "Загрузка общего Core",
  "runtime.ready": "Общий Core готов",
  "runtime.required": "Нужен общий Core",
  "runtime.contract": "контракт {version}",
  "host.browser": "хост браузера",
  "host.browserUnavailable": "браузер недоступен",
  "host.telegram": "хост Telegram",
  "host.telegramUnavailable": "Telegram недоступен",
  "host.discord": "хост Discord",
  "host.discordUnavailable": "Discord недоступен",
  "host.native": "нативный хост",
  "host.nativeUnavailable": "нативный хост недоступен",
  "dock.you": "Вы",
  "dock.spectate": "наблюдает",
  "dock.driving": "за рулём",
  "dock.ready": "готово",
  "dock.preparing": "готовится",
  "dock.download": "загрузить",
  "dock.unavailable": "недоступно",
  "dock.noRelationship": "Взаимная связь не утверждается",
  "dock.focusWorld": "Сфокусировать мир на {name}",
  "dock.takeWheel": "Сесть за руль как {name}",
  "dock.handWheel": "Передать руль {name}",
  "dock.setUp": "Настроить {name}",
  "dock.editNamed": "Изменить {name}",
  "dock.noStudy":
    "Исследование ещё не выбрано — аватар не появится, пока вы не выберете.",
  "dock.unsupportedStudy":
    "Этот Bond выбрал {model}, и этот клиент не может это показать. Обновите 0x1, чтобы отобразить этот выбор.",
  "dock.addProvider": "Добавить провайдера",
  "dock.loading": "Загрузка…",
  "dock.loadingProviders": "Загрузка подключений провайдеров…",
  "dock.connect": "Подключить",
  "dock.avaiaSaved": "Avaia сохранена",
  "dock.saveChoiceFailed":
    "Не удалось сохранить этот выбор. Попробуйте ещё раз.",

  "identity.eyebrow": "Идентичность 0x1",
  "identity.stage": "пре-альфа",
  "identity.or": "или",
  "identity.heading.avatar": "Выберите своё тело.",
  "identity.heading.password": "Создайте пароль.",
  "identity.heading.recovery": "Сохраните ключ восстановления.",
  "identity.heading.register": "Создайте свой Bond.",
  "identity.heading.welcome": "С возвращением.",
  "identity.heading.choose": "Выберите свой pub_dress.",
  "identity.heading.enter": "Введите свой pub_dress.",
  "identity.heading.default": "Один адрес. Один вход.",
  "identity.lede.avatar":
    "Так вас будет рисовать мир. Изменить это можно в любой момент в профиле.",
  "identity.lede.password":
    "Этот пароль позволяет входить в тот же Bond вне {provider}.",
  "identity.lede.recovery":
    "Это единственное нативное доказательство для восстановления. Оно показывается только один раз.",
  "identity.lede.authenticated": "Мир загружается за этим экраном.",
  "identity.lede.register":
    "Провайдер не нужен. Ваш точный адрес с учётом регистра принадлежит этому Bond.",
  "identity.lede.remembered": "{name} запомнен в этом браузере.",
  "identity.lede.rememberedFallback": "Этот Bond",
  "identity.lede.provider":
    "Провайдер подтверждает, кто вы; идентичность по-прежнему принадлежит 0x1.",
  "identity.lede.default":
    "Одно поле само определяет, регистрироваться вам или входить.",
  "identity.provider.signInWith": "Войти через",
  "identity.provider.signInWithNamed": "Войти через {provider}",
  "identity.provider.web": "веб",
  "identity.provider.verified":
    "{provider} подтверждён. Уже есть Bond? Войдите ниже, и мы подключим {provider}. Впервые здесь? Создайте свой Bond ниже.",
  "identity.avatar.label": "Исследование аватара",
  "identity.avatar.later": "Решить позже",
  "identity.recovery.label": "Ключ восстановления",
  "identity.recovery.copy": "Копировать",
  "identity.recovery.copied": "Скопировано",
  "identity.recovery.download": "Скачать",
  "identity.recovery.saved": "Я сохранил(а) этот ключ восстановления",
  "identity.recovery.completing": "Завершаем…",
  "identity.recovery.continue": "Перейти в 0x1",
  "identity.recovery.file":
    "Нативный ключ восстановления 0x1\n\nBond: {pubDress}\nКлюч: {key}\n",
  "identity.form.signIn": "Войти",
  "identity.form.create": "Создать {name}",
  "identity.form.edit": "Изменить {name}",
  "identity.form.discriminator": "шестнадцатеричный дискриминатор pub_dress",
  "identity.form.slugPlaceholder": "имя",
  "identity.form.continueWith": "Продолжить как {name}",
  "identity.form.passwordPlaceholder": "пароль",
  "identity.form.password": "Пароль",
  "identity.form.showPassword": "Показать пароль",
  "identity.form.hidePassword": "Скрыть пароль",
  "identity.form.passwordRules":
    "8–128 символов Unicode · без пробелов в начале и в конце · без переносов строки",
  "identity.form.notYou": "Не вы?",
  "identity.authenticated": "Аутентифицированный Bond",
  "identity.password.confirm": "Подтвердите пароль",
  "identity.password.show": "Показать пароли",
  "identity.password.hide": "Скрыть пароли",
  "identity.password.mismatch": "Пароли не совпадают.",
  "identity.password.saving": "Сохраняем…",
  "identity.password.save": "Сохранить пароль",
  "identity.status.idle": "С учётом регистра · 2–32 символа",
  "identity.status.invalidLength": "Неверно — нужно 2–32 символа",
  "identity.status.invalidCharacter": "Неверно — этот символ не поддерживается",
  "identity.status.checking": "Проверяем доступность…",
  "identity.status.available": "Доступно — создайте эту идентичность",
  "identity.status.registered": "Bond найден — войдите",
  "identity.status.taken": "Недоступно — такой Bond уже существует",
  "identity.status.unverified":
    "Недоступно — не удалось проверить эту идентичность",
  "identity.detail.checkingBrowser": "Проверяем этот браузер…",
  "identity.detail.authUnavailable":
    "Аутентификация идентичности временно недоступна.",
  "identity.detail.openFromProvider":
    "Откройте 0x1 из {provider}, чтобы продолжить.",
  "identity.detail.openFromAnyProvider":
    "Откройте 0x1 у провайдера, чтобы продолжить.",
  "identity.detail.checkingAccount": "Проверяем аккаунт {provider}…",
  "identity.detail.checkingAnyAccount": "Проверяем аккаунт провайдера…",
  "identity.detail.registrationUnavailable":
    "Регистрация идентичности временно недоступна.",
  "identity.detail.reopenFromProvider": "Снова откройте 0x1 из {provider}.",
  "identity.detail.reopenFromAnyProvider": "Снова откройте 0x1 у провайдера.",
  "identity.detail.telegramTypeLinked":
    "Этот аккаунт Bond уже привязан к другому аккаунту Telegram. Войдите через тот аккаунт или отвяжите его в веб-приложении, прежде чем привязывать другой аккаунт Telegram.",
  "identity.detail.telegramLinked":
    "Этот аккаунт Telegram уже привязан к другому Bond.",
  "identity.detail.telegramRetry":
    "Не удалось подключить Telegram к этому Bond. Попробуйте ещё раз.",
  "identity.detail.telegramNow":
    "Сейчас не удалось подключить Telegram к этому Bond.",
  "identity.detail.connecting": "Подключаем {provider} к {name}…",
  "identity.detail.providerLinked": "{provider} уже подключён к другому Bond.",
  "identity.detail.providerRetry":
    "Не удалось подключить {provider} к этому Bond. Авторизуйте {provider} ещё раз.",
  "identity.detail.providerNow": "Сейчас не удалось подключить {provider}.",
  "identity.error.setup": "Не удалось завершить настройку. Попробуйте ещё раз.",
  "identity.error.authUnavailable": "Аутентификация временно недоступна.",
  "identity.error.registrationUnavailable": "Регистрация временно недоступна.",
  "identity.error.passwordShort": "Используйте не меньше 8 символов.",
  "identity.error.passwordLeaked":
    "Выберите пароль, которого нет в известных утечках.",
  "identity.error.justRegistered":
    "Этот pub_dress только что зарегистрировали. Проверьте его ещё раз.",
  "identity.error.alreadyCommitted":
    "Регистрация уже зафиксирована, и её ключ восстановления нельзя показать снова.",
  "identity.error.rateLimited":
    "Слишком много попыток. Подождите, прежде чем пробовать снова.",
  "identity.error.invalidCredentials": "Неверный pub_dress или пароль.",
  "identity.error.challengeExpired":
    "Срок подтверждения регистрации истёк. Начните заново.",
  "identity.error.reauthenticate":
    "Войдите у провайдера ещё раз и повторите попытку.",
  "identity.error.slugLength": "Используйте 2–32 символа после 0x.",
  "identity.error.slugCharacter":
    "В этом имени есть символ, который 0x1 не принимает.",
  "identity.error.slugUnavailable":
    "Этот pub_dress нельзя зарегистрировать. Выберите другой.",
  "identity.error.passwordSave":
    "Не удалось сохранить пароль. Попробуйте ещё раз.",
  "identity.error.reopenProvider":
    "Снова откройте 0x1 из {provider}, чтобы продолжить.",
  "identity.error.passwordSet":
    "Пароль уже установлен. Снова откройте 0x1, чтобы войти.",
  "identity.error.passwordFormat":
    "Используйте 8–128 символов без пробелов по краям и переносов строки.",
  "identity.runtime.loading": "Проверяем версионированную границу WebAssembly.",
  "identity.runtime.ready": "Контракт {version} доступен веб-клиенту.",
  "identity.runtime.artifactMissing":
    "Версионированный артефакт Rust не подключён к этой сборке. Интерфейс не будет выдумывать его поведение на TypeScript.",
  "identity.runtime.bindingInvalid":
    "Загруженная привязка не предоставила корректную версию контракта, поэтому клиент остановился до создания состояния продукта.",
  "identity.runtime.loadFailed":
    "Не удалось загрузить общий runtime. Это остаётся видимым состоянием недоступности.",
  "identity.url.label": "публичный адрес",
  "identity.url.folded":
    "Core сводит этот адрес ASCII к канонической метке в нижнем регистре",
  "identity.url.encoded": "Кодирование DNS проверено 0x1 Core",
  "identity.url.verified": "Адрес проверен 0x1 Core",
  "identity.url.disallowedScalar":
    "Адреса нет — контракт адресов Core не допускает этот символ",
  "identity.url.bidi":
    "Адреса нет — письмо справа налево не может идти после префикса 0x",
  "identity.url.notEncodable":
    "Адреса нет — Core не может закодировать это значение как одну метку DNS",
  "identity.url.unsupportedCharacter":
    "Адреса нет — этот символ не может быть в метке DNS",
  "identity.url.boundaryHyphen":
    "Адреса нет — адрес не может заканчиваться дефисом",
  "identity.url.tooLong": "Адреса нет — это слишком длинно для одной метки DNS",
  "identity.url.notPubDress":
    "Адреса нет — сначала завершите канонический pub_dress",
  "identity.url.checking": "Проверяем этот адрес…",
  "identity.url.free": "Этот адрес свободен",
  "identity.url.taken":
    "Этот адрес занят другим Bond — добавьте отличительную часть",
  "identity.url.invalid": "Эта часть не может быть в адресе",
  "identity.url.unverified": "Недоступно — не удалось проверить этот адрес",
  "identity.url.deriving": "Выводим этот адрес через 0x1 Core…",
  "identity.url.notDerived": "Недоступно — 0x1 Core не предоставил адрес",
  "identity.url.composing": "Проверяем отличительную часть через 0x1 Core…",
  "identity.url.notComposed": "Недоступно — 0x1 Core не составил этот адрес",
  "identity.url.suffix": "Отличительная часть {name}",
  "identity.url.suggest": "Предложить другую отличительную часть",

  "map.status.idle": "Карта неактивна",
  "map.status.idleDetail": "Географический рендерер ещё не смонтирован.",
  "map.status.loading": "Загрузка карты",
  "map.status.loadingDetail": "Загружаем собственный стиль карты 0x1.",
  "map.status.ready": "Карта готова",
  "map.status.readyDetail": "MapLibre отображает географическую основу.",
  "map.status.unavailable": "Карта недоступна",
  "map.status.styleLoadFailed":
    "Версионированный собственный стиль карты ещё не опубликован.",
  "map.status.basemapLoadFailed":
    "Не удалось прочитать версионированный собственный архив базовой карты.",
  "map.status.styleLoadTimeout": "Собственный стиль карты не ответил вовремя.",
  "map.status.firstPaintTimeout":
    "Стиль карты загрузился, но рендерер так и не нарисовал первый кадр.",
  "map.status.webglUnavailable":
    "Этот браузер не смог создать контекст WebGL2, нужный карте.",
  "map.status.webglContextLost": "Этот браузер потерял контекст WebGL карты.",
  "map.status.containerZeroSize":
    "Поверхность карты на этом клиенте имеет нулевой размер.",
  "map.status.rendererInitFailed":
    "На этом клиенте не удалось создать рендерер карты.",
  "map.status.unknownFailure":
    "На этом клиенте не удалось запустить географический рендерер.",
  "map.focus.locating":
    "Определяем местоположение устройства, чтобы сфокусировать карту.",
  "map.focus.focused": "Камера карты сфокусирована рядом с этим устройством.",
  "map.focus.unavailable": "Местоположение устройства недоступно.",
  "toast.reference": "Справка",
  "toast.dismiss": "Закрыть",
  "toast.readMore": "Подробнее",
  "toast.readLess": "Свернуть",
  "chrome.skip": "Перейти к содержимому",
  "chrome.home": "Главная 0x1",
  "chrome.currentHost": "Текущий хост",
  "avatar.detail.masculine": "маскулинное исследование",
  "avatar.detail.feminine": "феминное исследование",
  "avatar.detail.nonBinary": "небинарное исследование",
  "avatar.detail.changeable": "феминное исследование · сменная одежда",
  "avatar.note.editable":
    "Волосы, одежда и обувь отделены от тела. Их смена никогда не меняет того, кем является это исследование.",
  "avatar.note.fixed":
    "{name} — цельное скульптурное исследование: у этого тела нет отдельной одежды. Сменная одежда есть у Dasha 2.0.",
  "avatar.note.storage":
    "Тело хранится вместе с этим Bond. То, что на нём надето, хранится только на этом устройстве.",
  "avatar.preview.draft": "{name} в этом черновике",
  "avatar.preview.saved": "{name} в сохранённом виде",
  "avatar.field.notChosen": "Не выбрано",
  "avatar.field.noBody": "тело не появится, пока вы его не выберете",
  "avatar.field.chooseYours": "Выбрать свою 3D-модель",
  "avatar.field.chooseAvaia": "Выбрать 3D-модель этой Avaia",
  "avatar.field.changeYours": "Изменить свою 3D-модель — сейчас {name}",
  "avatar.field.changeAvaia": "Изменить 3D-модель этой Avaia — сейчас {name}",
  "avatar.error.signIn": "Войдите снова, чтобы изменить это.",
  "avatar.error.unknownModel": "Это исследование не опубликовано.",
  "avatar.error.tooManyChanges":
    "Слишком много изменений. Подождите, прежде чем пробовать снова.",
  "address.error.save": "Не удалось сохранить этот адрес. Попробуйте ещё раз.",
  "address.error.signIn": "Войдите снова, чтобы изменить этот адрес.",
  "address.error.bondTaken": "Этот адрес принадлежит другому Bond.",
  "address.error.avaiaTaken":
    "Этот адрес Avaia принадлежит другой идентичности.",
  "address.error.length":
    "Длина этого имени выходит за пределы, допустимые для адреса.",
  "address.error.avaiaSuffix": "Имя Avaia заканчивается на {suffix}.",
  "address.error.character":
    "Уберите символы, которых не может быть в адресе, например пробелы.",
  "address.error.range": "Количество символов: {min}–{max}.",
  "address.note.fixed": "Этот адрес нельзя изменить на этом хосте.",
  "address.note.range": "С учётом регистра · символов: {min}–{max}",
  "address.saved": "Сохранено. Теперь это {name}.",
  "avaia.setup.reading": "Читаем эту Avaia…",
  "avaia.setup.signIn": "Войдите снова, чтобы изменить эту Avaia.",
  "avaia.setup.unreadable":
    "Эту Avaia сейчас не удаётся прочитать. Попробуйте ещё раз.",
  "avaia.setup.unsupported": "Этот хост пока не может настроить Avaia.",
  "avaia.setup.invalidAddress": "Такой адрес не подходит для Avaia.",
  "avaia.setup.discriminator":
    "Avaia сохраняет дискриминатор Bond, которому принадлежит.",
  "avaia.setup.taken": "Этот адрес принадлежит другой идентичности.",
  "provider.open": "Открыть {provider}",
  "provider.connect": "Подключить {provider}",
  "provider.disconnect": "Отключить {provider} от этого Bond",
  "public.resolving": "Определяем адрес…",
  "public.notFound": "Bond не найден.",
  "public.unavailable": "Временно недоступно.",
  "public.notFoundDetail": "Этому публичному адресу не назначен ни один Bond.",
  "public.unavailableDetail":
    "Публичный сервис идентичности не смог ответить для этого адреса.",
  "public.body": "тело",
  "public.location": "местоположение",
  "public.experience.bond": "Bond",
  "public.experience.avaia": "Avaia",
  "public.experience.summary": "Уровень {level} · {xp} опыта",
  "public.experience.reported": "Сообщено этим Bond",
  "public.enter": "перейти на nilx.one",
  "discord.bootstrapFailed":
    "0x1 не удалось запустить этот сеанс Discord Activity. Откройте Activity снова и повторите попытку. ({reason})",
  "discord.unknownFailure": "Неизвестный сбой",
  ...GUIDE_RU,
};
