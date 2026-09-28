// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Map status, shared chrome, avatar, address and public-page copy. Entries whose
 * English is produced by a view-model are presented through `translateCopy`,
 * so the English here must stay exactly what that view-model says.
 */
export const WORLD_EN = {
  "map.status.idle": "Map idle",
  "map.status.idleDetail": "The geographic renderer has not mounted yet.",
  "map.status.loading": "Loading map",
  "map.status.loadingDetail": "Loading the self-hosted 0x1 map style.",
  "map.status.ready": "Map ready",
  "map.status.readyDetail": "MapLibre is rendering the geographic substrate.",
  "map.status.unavailable": "Map unavailable",
  "map.status.styleLoadFailed":
    "The versioned self-hosted map style is not published yet.",
  "map.status.basemapLoadFailed":
    "The versioned self-hosted basemap archive could not be read.",
  "map.status.styleLoadTimeout":
    "The self-hosted map style did not answer in time.",
  "map.status.firstPaintTimeout":
    "The map style loaded, but the renderer never drew a first frame.",
  "map.status.webglUnavailable":
    "This browser could not create the WebGL2 context the map needs.",
  "map.status.webglContextLost":
    "This browser dropped the map's WebGL context.",
  "map.status.containerZeroSize":
    "The map surface resolved to zero size on this client.",
  "map.status.rendererInitFailed":
    "The map renderer could not be created on this client.",
  "map.status.unknownFailure":
    "The geographic renderer could not start on this client.",
  "map.focus.locating": "Locating this device for local map focus.",
  "map.focus.focused": "Map camera focused near this device.",
  "map.focus.unavailable": "Device location is unavailable.",
  "toast.reference": "Reference",
  "toast.dismiss": "Dismiss",
  "toast.readMore": "Read more",
  "toast.readLess": "Read less",
  "chrome.skip": "Skip to content",
  "chrome.home": "0x1 home",
  "chrome.currentHost": "Current host",
  "avatar.detail.masculine": "masculine study",
  "avatar.detail.feminine": "feminine study",
  "avatar.detail.nonBinary": "non-binary study",
  "avatar.detail.changeable": "feminine study · changeable clothes",
  "avatar.note.editable":
    "Hair, clothes and shoes are separate from the body. Changing them never changes who this study is.",
  "avatar.note.fixed":
    "{name} is one sculpted study: this body has no separate clothes to change. Dasha 2.0 is the study that does.",
  "avatar.note.storage":
    "The body is kept with this Bond. What it wears is kept on this device only.",
  "avatar.preview.draft": "{name}, as this draft would look",
  "avatar.preview.saved": "{name}, as it is saved",
  "avatar.field.notChosen": "Not chosen",
  "avatar.field.noBody": "no body is drawn until you choose one",
  "avatar.field.chooseYours": "Choose your 3D model",
  "avatar.field.chooseAvaia": "Choose this Avaia's 3D model",
  "avatar.field.changeYours": "Change your 3D model — currently {name}",
  "avatar.field.changeAvaia": "Change this Avaia's 3D model — currently {name}",
  "avatar.error.signIn": "Sign in again to change this.",
  "avatar.error.unknownModel": "That study is not published.",
  "avatar.error.tooManyChanges": "Too many changes. Wait before trying again.",
  "address.error.save": "Couldn’t save this address. Try again.",
  "address.error.signIn": "Sign in again to change this address.",
  "address.error.bondTaken": "That address belongs to another Bond.",
  "address.error.avaiaTaken": "That Avaia address belongs to another identity.",
  "address.error.length":
    "That name is outside the length this address allows.",
  "address.error.avaiaSuffix": "An Avaia name ends in {suffix}.",
  "address.error.character":
    "Remove characters an address can’t hold, like spaces.",
  "address.error.range": "Use {min}–{max} characters.",
  "address.note.fixed": "This address cannot be edited on this host.",
  "address.note.range": "Case-sensitive · {min}–{max} characters",
  "address.saved": "Saved. This is {name}.",
  "avaia.setup.reading": "Reading this Avaia…",
  "avaia.setup.signIn": "Sign in again to change this Avaia.",
  "avaia.setup.unreadable": "This Avaia can’t be read right now. Try again.",
  "avaia.setup.unsupported": "This host cannot configure an Avaia yet.",
  "avaia.setup.invalidAddress": "That is not an address an Avaia can hold.",
  "avaia.setup.discriminator":
    "An Avaia keeps the discriminator of the Bond that owns it.",
  "avaia.setup.taken": "That address belongs to another identity.",
  "provider.open": "Open {provider}",
  "provider.connect": "Connect {provider}",
  "provider.disconnect": "Disconnect {provider} from this Bond",
  "public.resolving": "Resolving address…",
  "public.notFound": "Bond not found.",
  "public.unavailable": "Temporarily unavailable.",
  "public.notFoundDetail": "No Bond is allocated to this public address.",
  "public.unavailableDetail":
    "The public identity service could not answer this address.",
  "public.body": "body",
  "public.location": "location",
  "public.experience.bond": "Bond",
  "public.experience.avaia": "Avaia",
  "public.experience.summary": "Level {level} · {xp} xp",
  "public.enter": "enter nilx.one",
  "discord.bootstrapFailed":
    "0x1 could not start this Discord Activity session. Reopen the Activity and try again. ({reason})",
  "discord.unknownFailure": "Unknown failure",
} as const;

export const WORLD_UK: Readonly<Record<keyof typeof WORLD_EN, string>> = {
  "map.status.idle": "Мапа неактивна",
  "map.status.idleDetail": "Географічний рендерер ще не змонтовано.",
  "map.status.loading": "Завантаження мапи",
  "map.status.loadingDetail": "Завантажуємо власний стиль мапи 0x1.",
  "map.status.ready": "Мапа готова",
  "map.status.readyDetail": "MapLibre відображає географічну основу.",
  "map.status.unavailable": "Мапа недоступна",
  "map.status.styleLoadFailed":
    "Версіонований власний стиль мапи ще не опубліковано.",
  "map.status.basemapLoadFailed":
    "Не вдалося прочитати версіонований власний архів базової мапи.",
  "map.status.styleLoadTimeout": "Власний стиль мапи не відповів вчасно.",
  "map.status.firstPaintTimeout":
    "Стиль мапи завантажився, але рендерер так і не намалював перший кадр.",
  "map.status.webglUnavailable":
    "Цей браузер не зміг створити контекст WebGL2, потрібний мапі.",
  "map.status.webglContextLost": "Цей браузер втратив контекст WebGL мапи.",
  "map.status.containerZeroSize":
    "Поверхня мапи на цьому клієнті має нульовий розмір.",
  "map.status.rendererInitFailed":
    "На цьому клієнті не вдалося створити рендерер мапи.",
  "map.status.unknownFailure":
    "На цьому клієнті не вдалося запустити географічний рендерер.",
  "map.focus.locating":
    "Визначаємо місцезнаходження пристрою, щоб сфокусувати мапу.",
  "map.focus.focused": "Камеру мапи сфокусовано біля цього пристрою.",
  "map.focus.unavailable": "Місцезнаходження пристрою недоступне.",
  "toast.reference": "Довідка",
  "toast.dismiss": "Закрити",
  "toast.readMore": "Докладніше",
  "toast.readLess": "Згорнути",
  "chrome.skip": "Перейти до вмісту",
  "chrome.home": "Головна 0x1",
  "chrome.currentHost": "Поточний хост",
  "avatar.detail.masculine": "маскулінне дослідження",
  "avatar.detail.feminine": "фемінне дослідження",
  "avatar.detail.nonBinary": "небінарне дослідження",
  "avatar.detail.changeable": "фемінне дослідження · змінний одяг",
  "avatar.note.editable":
    "Волосся, одяг і взуття окремі від тіла. Їхня зміна ніколи не змінює, ким є це дослідження.",
  "avatar.note.fixed":
    "{name} — цілісне скульптурне дослідження: у цього тіла немає окремого одягу. Змінний одяг є в Dasha 2.0.",
  "avatar.note.storage":
    "Тіло зберігається з цим Bond. Те, що воно носить, зберігається лише на цьому пристрої.",
  "avatar.preview.draft": "{name} у цій чернетці",
  "avatar.preview.saved": "{name} у збереженому вигляді",
  "avatar.field.notChosen": "Не обрано",
  "avatar.field.noBody": "тіло не з’являється, доки ви його не оберете",
  "avatar.field.chooseYours": "Обрати свою 3D модель",
  "avatar.field.chooseAvaia": "Обрати 3D модель цієї Avaia",
  "avatar.field.changeYours": "Змінити свою 3D модель — зараз {name}",
  "avatar.field.changeAvaia": "Змінити 3D модель цієї Avaia — зараз {name}",
  "avatar.error.signIn": "Увійдіть знову, щоб змінити це.",
  "avatar.error.unknownModel": "Це дослідження не опубліковано.",
  "avatar.error.tooManyChanges":
    "Забагато змін. Зачекайте, перш ніж пробувати знову.",
  "address.error.save": "Не вдалося зберегти цю адресу. Спробуйте ще раз.",
  "address.error.signIn": "Увійдіть знову, щоб змінити цю адресу.",
  "address.error.bondTaken": "Ця адреса належить іншому Bond.",
  "address.error.avaiaTaken": "Ця адреса Avaia належить іншій ідентичності.",
  "address.error.length":
    "Довжина цієї назви виходить за межі, дозволені для адреси.",
  "address.error.avaiaSuffix": "Назва Avaia закінчується на {suffix}.",
  "address.error.character":
    "Приберіть символи, яких не може бути в адресі, наприклад пробіли.",
  "address.error.range": "Кількість символів: {min}–{max}.",
  "address.note.fixed": "Цю адресу не можна змінити на цьому хості.",
  "address.note.range": "З урахуванням регістру · символів: {min}–{max}",
  "address.saved": "Збережено. Тепер це {name}.",
  "avaia.setup.reading": "Читаємо цю Avaia…",
  "avaia.setup.signIn": "Увійдіть знову, щоб змінити цю Avaia.",
  "avaia.setup.unreadable":
    "Цю Avaia зараз не вдається прочитати. Спробуйте ще раз.",
  "avaia.setup.unsupported": "Цей хост поки не може налаштувати Avaia.",
  "avaia.setup.invalidAddress": "Така адреса не підходить для Avaia.",
  "avaia.setup.discriminator":
    "Avaia зберігає дискримінатор Bond, якому належить.",
  "avaia.setup.taken": "Ця адреса належить іншій ідентичності.",
  "provider.open": "Відкрити {provider}",
  "provider.connect": "Підключити {provider}",
  "provider.disconnect": "Від’єднати {provider} від цього Bond",
  "public.resolving": "Визначаємо адресу…",
  "public.notFound": "Bond не знайдено.",
  "public.unavailable": "Тимчасово недоступно.",
  "public.notFoundDetail": "Цій публічній адресі не призначено жодного Bond.",
  "public.unavailableDetail":
    "Публічний сервіс ідентичності не зміг відповісти для цієї адреси.",
  "public.body": "тіло",
  "public.location": "місцезнаходження",
  "public.experience.bond": "Bond",
  "public.experience.avaia": "Avaia",
  "public.experience.summary": "Рівень {level} · {xp} досвіду",
  "public.enter": "перейти на nilx.one",
  "discord.bootstrapFailed":
    "0x1 не вдалося запустити цей сеанс Discord Activity. Відкрийте Activity знову й повторіть спробу. ({reason})",
  "discord.unknownFailure": "Невідомий збій",
};
