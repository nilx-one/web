// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export const AUTH_COPY_EN = {
  label: "Username",
  discriminator: "Prefix",
  edit: "Edit {name}",
  continueWith: "Continue with {name}",
  slugPlaceholder: "Your name",
  passwordPlaceholder: "Password",
  password: "Password",
  hidePassword: "Hide password",
  showPassword: "Show password",
  passwordRules: "8–128 characters. Do not add spaces at the beginning or end.",
  notYou: "Not you?",
  signIn: "Sign in",
  create: "Create account",
};
export type AuthCopy = { [K in keyof typeof AUTH_COPY_EN]: string };
export const AUTH_COPY_UK: AuthCopy = {
  label: "Ім’я користувача",
  discriminator: "Префікс",
  edit: "Змінити {name}",
  continueWith: "Продовжити з {name}",
  slugPlaceholder: "Ваше ім’я",
  passwordPlaceholder: "Пароль",
  password: "Пароль",
  hidePassword: "Приховати пароль",
  showPassword: "Показати пароль",
  passwordRules: "8–128 символів. Без пробілів на початку та в кінці.",
  notYou: "Це не ви?",
  signIn: "Увійти",
  create: "Створити акаунт",
};
