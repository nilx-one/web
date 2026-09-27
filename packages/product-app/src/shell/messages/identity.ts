// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Sign-in, registration, provider password and recovery copy. Entries whose
 * English is produced by a view-model are presented through `translateCopy`,
 * so the English here must stay exactly what that view-model says.
 */
export const IDENTITY_EN = {
  "identity.eyebrow": "0x1 identity",
  "identity.stage": "pre-alpha",
  "identity.or": "or",
  "identity.heading.avatar": "Choose your body.",
  "identity.heading.password": "Create your password.",
  "identity.heading.recovery": "Save your recovery key.",
  "identity.heading.register": "Create your Bond.",
  "identity.heading.welcome": "Welcome back.",
  "identity.heading.choose": "Choose your pub_dress.",
  "identity.heading.enter": "Enter your pub_dress.",
  "identity.heading.default": "One address. One way in.",
  "identity.lede.avatar":
    "This is how the world will draw you. You can change it any time in your profile.",
  "identity.lede.password":
    "Use this password to sign in to the same Bond outside {provider}.",
  "identity.lede.recovery":
    "This is the only native recovery proof. It appears once.",
  "identity.lede.authenticated": "The world is loading behind this surface.",
  "identity.lede.register":
    "No provider required. Your exact, case-sensitive address belongs to this Bond.",
  "identity.lede.remembered": "{name} is remembered on this browser.",
  "identity.lede.rememberedFallback": "This Bond",
  "identity.lede.provider":
    "The provider proves who you are; 0x1 still owns the identity.",
  "identity.lede.default":
    "The same field resolves registration or sign-in for you.",
  "identity.provider.signInWith": "Sign in with",
  "identity.provider.signInWithNamed": "Sign in with {provider}",
  "identity.provider.web": "web",
  "identity.provider.verified":
    "{provider} verified. Already have a Bond? Sign in below and we’ll connect {provider}. New here? Create your Bond below.",
  "identity.avatar.label": "Avatar study",
  "identity.avatar.later": "Decide later",
  "identity.recovery.label": "Recovery key",
  "identity.recovery.copy": "Copy",
  "identity.recovery.copied": "Copied",
  "identity.recovery.download": "Download",
  "identity.recovery.saved": "I saved this recovery key",
  "identity.recovery.completing": "Completing…",
  "identity.recovery.continue": "Continue to 0x1",
  "identity.recovery.file":
    "0x1 native recovery key\n\nBond: {pubDress}\nKey: {key}\n",
  "identity.form.signIn": "Sign in",
  "identity.form.create": "Create {name}",
  "identity.form.edit": "Edit {name}",
  "identity.form.discriminator": "pub_dress hexadecimal discriminator",
  "identity.form.slugPlaceholder": "slug",
  "identity.form.continueWith": "Continue with {name}",
  "identity.form.passwordPlaceholder": "password",
  "identity.form.password": "Password",
  "identity.form.showPassword": "Show password",
  "identity.form.hidePassword": "Hide password",
  "identity.form.passwordRules":
    "8–128 Unicode characters · no leading/trailing whitespace · no line breaks",
  "identity.form.notYou": "Not you?",
  "identity.authenticated": "Authenticated Bond",
  "identity.password.confirm": "Confirm password",
  "identity.password.show": "Show passwords",
  "identity.password.hide": "Hide passwords",
  "identity.password.mismatch": "Passwords don’t match.",
  "identity.password.saving": "Saving…",
  "identity.password.save": "Save password",
  "identity.status.idle": "Case-sensitive · 2–32 characters",
  "identity.status.invalidLength": "Incorrect — use 2–32 characters",
  "identity.status.invalidCharacter":
    "Incorrect — this character isn’t supported",
  "identity.status.checking": "Checking availability…",
  "identity.status.available": "Available — create this identity",
  "identity.status.registered": "Bond found — sign in",
  "identity.status.taken": "Unavailable — this Bond already exists",
  "identity.status.unverified": "Unavailable — couldn’t verify this identity",
  "identity.detail.checkingBrowser": "Checking this browser…",
  "identity.detail.authUnavailable":
    "Identity authentication is temporarily unavailable.",
  "identity.detail.openFromProvider": "Open 0x1 from {provider} to continue.",
  "identity.detail.openFromAnyProvider":
    "Open 0x1 from this provider to continue.",
  "identity.detail.checkingAccount": "Checking this {provider} account…",
  "identity.detail.checkingAnyAccount": "Checking this provider account…",
  "identity.detail.registrationUnavailable":
    "Identity registration is temporarily unavailable.",
  "identity.detail.reopenFromProvider": "Reopen 0x1 from {provider}.",
  "identity.detail.reopenFromAnyProvider": "Reopen 0x1 from the provider.",
  "identity.detail.telegramTypeLinked":
    "This Bond account is already linked to another Telegram account. Sign in with that account or unlink it in the web app before linking a different Telegram account.",
  "identity.detail.telegramLinked":
    "This Telegram account is already linked to another Bond.",
  "identity.detail.telegramRetry":
    "Could not connect Telegram to this Bond. Try again.",
  "identity.detail.telegramNow":
    "Could not connect Telegram to this Bond right now.",
  "identity.detail.connecting": "Connecting {provider} to {name}…",
  "identity.detail.providerLinked":
    "{provider} is already connected to another Bond.",
  "identity.detail.providerRetry":
    "Could not connect {provider} to this Bond. Authorize {provider} again.",
  "identity.detail.providerNow": "Could not connect {provider} right now.",
  "identity.error.setup": "Couldn’t finish setup. Try again.",
  "identity.error.authUnavailable":
    "Authentication is temporarily unavailable.",
  "identity.error.registrationUnavailable":
    "Registration is temporarily unavailable.",
  "identity.error.passwordShort": "Use at least 8 characters.",
  "identity.error.passwordLeaked":
    "Choose a password that hasn’t appeared in known leaks.",
  "identity.error.justRegistered":
    "That pub_dress was just registered. Resolve it again.",
  "identity.error.alreadyCommitted":
    "Registration already committed and its recovery key can’t be shown again.",
  "identity.error.rateLimited": "Too many attempts. Wait before trying again.",
  "identity.error.invalidCredentials": "The pub_dress or password is invalid.",
  "identity.error.challengeExpired":
    "This registration acknowledgement expired. Start again.",
  "identity.error.reauthenticate":
    "Reauthenticate with the provider and try again.",
  "identity.error.slugLength": "Use 2–32 characters after 0x.",
  "identity.error.slugCharacter":
    "That slug contains a character 0x1 does not accept.",
  "identity.error.slugUnavailable":
    "That pub_dress cannot be registered. Choose another one.",
  "identity.error.passwordSave": "Couldn’t save your password. Try again.",
  "identity.error.reopenProvider": "Reopen 0x1 from {provider} to continue.",
  "identity.error.passwordSet":
    "A password is already set. Reopen 0x1 to sign in.",
  "identity.error.passwordFormat":
    "Use 8–128 characters without surrounding whitespace or line breaks.",
  "identity.runtime.loading": "Checking the versioned WebAssembly boundary.",
  "identity.runtime.ready":
    "Contract {version} is available to the Web client.",
  "identity.runtime.artifactMissing":
    "The versioned Rust artifact is not connected to this build. The interface will not invent its behavior in TypeScript.",
  "identity.runtime.bindingInvalid":
    "The loaded binding did not expose a valid contract version, so the client stopped before creating product state.",
  "identity.runtime.loadFailed":
    "The shared runtime could not be loaded. This remains a visible unavailable state.",
  "identity.url.label": "public address",
  "identity.url.folded":
    "Core maps this ASCII address to its canonical lowercase label",
  "identity.url.encoded": "DNS encoding verified by 0x1 Core",
  "identity.url.verified": "Address verified by 0x1 Core",
  "identity.url.disallowedScalar":
    "No address — this scalar is not allowed by the Core address contract",
  "identity.url.bidi":
    "No address — a right-to-left script cannot follow the 0x prefix",
  "identity.url.notEncodable":
    "No address — Core cannot encode this value as one DNS label",
  "identity.url.unsupportedCharacter":
    "No address — this character cannot appear in a DNS label",
  "identity.url.boundaryHyphen":
    "No address — an address cannot end on a hyphen",
  "identity.url.tooLong": "No address — this is too long for one DNS label",
  "identity.url.notPubDress": "No address — finish a canonical pub_dress first",
  "identity.url.checking": "Checking this address…",
  "identity.url.free": "This address is free",
  "identity.url.taken":
    "Another Bond holds this address — add a distinguishing part",
  "identity.url.invalid": "That part cannot appear in an address",
  "identity.url.unverified": "Unavailable — couldn’t verify this address",
  "identity.url.deriving": "Deriving this address with 0x1 Core…",
  "identity.url.notDerived":
    "Unavailable — 0x1 Core did not provide an address",
  "identity.url.composing": "Checking this distinguishing part with 0x1 Core…",
  "identity.url.notComposed":
    "Unavailable — 0x1 Core did not compose this address",
  "identity.url.suffix": "Distinguishing part of {name}",
  "identity.url.suggest": "Suggest another distinguishing part",
} as const;

export const IDENTITY_UK: Readonly<Record<keyof typeof IDENTITY_EN, string>> = {
  "identity.eyebrow": "Ідентичність 0x1",
  "identity.stage": "пре-альфа",
  "identity.or": "або",
  "identity.heading.avatar": "Оберіть своє тіло.",
  "identity.heading.password": "Створіть пароль.",
  "identity.heading.recovery": "Збережіть ключ відновлення.",
  "identity.heading.register": "Створіть свій Bond.",
  "identity.heading.welcome": "З поверненням.",
  "identity.heading.choose": "Оберіть свій pub_dress.",
  "identity.heading.enter": "Введіть свій pub_dress.",
  "identity.heading.default": "Одна адреса. Один вхід.",
  "identity.lede.avatar":
    "Таким вас малюватиме світ. Змінити це можна будь-коли у профілі.",
  "identity.lede.password":
    "Цей пароль дає змогу входити в той самий Bond поза {provider}.",
  "identity.lede.recovery":
    "Це єдиний нативний доказ для відновлення. Він показується лише один раз.",
  "identity.lede.authenticated": "Світ завантажується за цим екраном.",
  "identity.lede.register":
    "Провайдер не потрібен. Ваша точна адреса з урахуванням регістру належить цьому Bond.",
  "identity.lede.remembered": "{name} запам’ятовано в цьому браузері.",
  "identity.lede.rememberedFallback": "Цей Bond",
  "identity.lede.provider":
    "Провайдер підтверджує, хто ви; ідентичність і далі належить 0x1.",
  "identity.lede.default":
    "Одне поле саме визначає, реєструватися вам чи входити.",
  "identity.provider.signInWith": "Увійти через",
  "identity.provider.signInWithNamed": "Увійти через {provider}",
  "identity.provider.web": "веб",
  "identity.provider.verified":
    "{provider} підтверджено. Уже маєте Bond? Увійдіть нижче, і ми підключимо {provider}. Вперше тут? Створіть свій Bond нижче.",
  "identity.avatar.label": "Дослідження аватара",
  "identity.avatar.later": "Вирішити пізніше",
  "identity.recovery.label": "Ключ відновлення",
  "identity.recovery.copy": "Копіювати",
  "identity.recovery.copied": "Скопійовано",
  "identity.recovery.download": "Завантажити",
  "identity.recovery.saved": "Ключ відновлення збережено",
  "identity.recovery.completing": "Завершуємо…",
  "identity.recovery.continue": "Перейти до 0x1",
  "identity.recovery.file":
    "Нативний ключ відновлення 0x1\n\nBond: {pubDress}\nКлюч: {key}\n",
  "identity.form.signIn": "Увійти",
  "identity.form.create": "Створити {name}",
  "identity.form.edit": "Змінити {name}",
  "identity.form.discriminator": "шістнадцятковий дискримінатор pub_dress",
  "identity.form.slugPlaceholder": "назва",
  "identity.form.continueWith": "Продовжити як {name}",
  "identity.form.passwordPlaceholder": "пароль",
  "identity.form.password": "Пароль",
  "identity.form.showPassword": "Показати пароль",
  "identity.form.hidePassword": "Сховати пароль",
  "identity.form.passwordRules":
    "8–128 символів Unicode · без пробілів на початку й у кінці · без розривів рядка",
  "identity.form.notYou": "Не ви?",
  "identity.authenticated": "Автентифікований Bond",
  "identity.password.confirm": "Підтвердьте пароль",
  "identity.password.show": "Показати паролі",
  "identity.password.hide": "Сховати паролі",
  "identity.password.mismatch": "Паролі не збігаються.",
  "identity.password.saving": "Зберігаємо…",
  "identity.password.save": "Зберегти пароль",
  "identity.status.idle": "З урахуванням регістру · 2–32 символи",
  "identity.status.invalidLength": "Неправильно — потрібно 2–32 символи",
  "identity.status.invalidCharacter":
    "Неправильно — цей символ не підтримується",
  "identity.status.checking": "Перевіряємо доступність…",
  "identity.status.available": "Доступно — створіть цю ідентичність",
  "identity.status.registered": "Bond знайдено — увійдіть",
  "identity.status.taken": "Недоступно — такий Bond уже існує",
  "identity.status.unverified":
    "Недоступно — не вдалося перевірити цю ідентичність",
  "identity.detail.checkingBrowser": "Перевіряємо цей браузер…",
  "identity.detail.authUnavailable":
    "Автентифікація ідентичності тимчасово недоступна.",
  "identity.detail.openFromProvider":
    "Відкрийте 0x1 з {provider}, щоб продовжити.",
  "identity.detail.openFromAnyProvider":
    "Відкрийте 0x1 у провайдера, щоб продовжити.",
  "identity.detail.checkingAccount": "Перевіряємо обліковий запис {provider}…",
  "identity.detail.checkingAnyAccount":
    "Перевіряємо обліковий запис провайдера…",
  "identity.detail.registrationUnavailable":
    "Реєстрація ідентичності тимчасово недоступна.",
  "identity.detail.reopenFromProvider": "Знову відкрийте 0x1 з {provider}.",
  "identity.detail.reopenFromAnyProvider": "Знову відкрийте 0x1 у провайдера.",
  "identity.detail.telegramTypeLinked":
    "Цей обліковий запис Bond уже пов’язано з іншим обліковим записом Telegram. Увійдіть через той обліковий запис або від’єднайте його у вебзастосунку, перш ніж пов’язувати інший обліковий запис Telegram.",
  "identity.detail.telegramLinked":
    "Цей обліковий запис Telegram уже пов’язано з іншим Bond.",
  "identity.detail.telegramRetry":
    "Не вдалося підключити Telegram до цього Bond. Спробуйте ще раз.",
  "identity.detail.telegramNow":
    "Зараз не вдалося підключити Telegram до цього Bond.",
  "identity.detail.connecting": "Підключаємо {provider} до {name}…",
  "identity.detail.providerLinked": "{provider} уже підключено до іншого Bond.",
  "identity.detail.providerRetry":
    "Не вдалося підключити {provider} до цього Bond. Авторизуйте {provider} ще раз.",
  "identity.detail.providerNow": "Зараз не вдалося підключити {provider}.",
  "identity.error.setup":
    "Не вдалося завершити налаштування. Спробуйте ще раз.",
  "identity.error.authUnavailable": "Автентифікація тимчасово недоступна.",
  "identity.error.registrationUnavailable": "Реєстрація тимчасово недоступна.",
  "identity.error.passwordShort": "Використайте щонайменше 8 символів.",
  "identity.error.passwordLeaked":
    "Оберіть пароль, якого немає у відомих витоках.",
  "identity.error.justRegistered":
    "Цей pub_dress щойно зареєстрували. Перевірте його ще раз.",
  "identity.error.alreadyCommitted":
    "Реєстрацію вже зафіксовано, і її ключ відновлення не можна показати знову.",
  "identity.error.rateLimited":
    "Забагато спроб. Зачекайте, перш ніж пробувати знову.",
  "identity.error.invalidCredentials": "Неправильний pub_dress або пароль.",
  "identity.error.challengeExpired":
    "Термін підтвердження реєстрації минув. Почніть знову.",
  "identity.error.reauthenticate":
    "Увійдіть у провайдера ще раз і повторіть спробу.",
  "identity.error.slugLength": "Використайте 2–32 символи після 0x.",
  "identity.error.slugCharacter": "У цій назві є символ, який 0x1 не приймає.",
  "identity.error.slugUnavailable":
    "Цей pub_dress не можна зареєструвати. Оберіть інший.",
  "identity.error.passwordSave":
    "Не вдалося зберегти пароль. Спробуйте ще раз.",
  "identity.error.reopenProvider":
    "Знову відкрийте 0x1 з {provider}, щоб продовжити.",
  "identity.error.passwordSet":
    "Пароль уже встановлено. Знову відкрийте 0x1, щоб увійти.",
  "identity.error.passwordFormat":
    "Використайте 8–128 символів без пробілів по краях і розривів рядка.",
  "identity.runtime.loading": "Перевіряємо версіоновану межу WebAssembly.",
  "identity.runtime.ready": "Контракт {version} доступний вебклієнту.",
  "identity.runtime.artifactMissing":
    "Версіонований артефакт Rust не підключено до цієї збірки. Інтерфейс не вигадуватиме його поведінку в TypeScript.",
  "identity.runtime.bindingInvalid":
    "Завантажена прив’язка не надала коректної версії контракту, тож клієнт зупинився до створення стану продукту.",
  "identity.runtime.loadFailed":
    "Не вдалося завантажити спільний runtime. Це лишається видимим станом недоступності.",
  "identity.url.label": "публічна адреса",
  "identity.url.folded":
    "Core зводить цю адресу ASCII до канонічної мітки в нижньому регістрі",
  "identity.url.encoded": "Кодування DNS перевірено 0x1 Core",
  "identity.url.verified": "Адресу перевірено 0x1 Core",
  "identity.url.disallowedScalar":
    "Адреси немає — контракт адрес Core не дозволяє цей символ",
  "identity.url.bidi":
    "Адреси немає — письмо справа наліво не може йти після префікса 0x",
  "identity.url.notEncodable":
    "Адреси немає — Core не може закодувати це значення як одну мітку DNS",
  "identity.url.unsupportedCharacter":
    "Адреси немає — цей символ не може бути в мітці DNS",
  "identity.url.boundaryHyphen":
    "Адреси немає — адреса не може закінчуватися дефісом",
  "identity.url.tooLong": "Адреси немає — це задовго для однієї мітки DNS",
  "identity.url.notPubDress":
    "Адреси немає — спершу завершіть канонічний pub_dress",
  "identity.url.checking": "Перевіряємо цю адресу…",
  "identity.url.free": "Ця адреса вільна",
  "identity.url.taken":
    "Цю адресу має інший Bond — додайте розрізнювальну частину",
  "identity.url.invalid": "Ця частина не може бути в адресі",
  "identity.url.unverified": "Недоступно — не вдалося перевірити цю адресу",
  "identity.url.deriving": "Виводимо цю адресу через 0x1 Core…",
  "identity.url.notDerived": "Недоступно — 0x1 Core не надав адреси",
  "identity.url.composing":
    "Перевіряємо розрізнювальну частину через 0x1 Core…",
  "identity.url.notComposed": "Недоступно — 0x1 Core не склав цієї адреси",
  "identity.url.suffix": "Розрізнювальна частина {name}",
  "identity.url.suggest": "Запропонувати іншу розрізнювальну частину",
};
