// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { mountMarketApp } from "@0xda-market/webapp-core";
import { catalogTransport } from "./transport";
import "./market.css";

const locale = new URLSearchParams(location.search).get("locale") ?? "en";
const copy = locale.startsWith("uk")
  ? {
      notice:
        "Каталог для перегляду. Купівля підписки за seeds ще не підключена.",
      failed: "Не вдалося завантажити каталог. Спробуйте ще раз.",
      retry: "Спробувати ще раз",
    }
  : locale.startsWith("ru")
    ? {
        notice:
          "Каталог для просмотра. Покупка подписки за seeds ещё не подключена.",
        failed: "Не удалось загрузить каталог. Попробуйте ещё раз.",
        retry: "Попробовать ещё раз",
      }
    : {
        notice:
          "Browse the catalog. Subscription purchases with seeds are not connected yet.",
        failed: "The catalog could not be loaded. Please try again.",
        retry: "Try again",
      };
for (const node of document.querySelectorAll("#browse-notice, .browse-details"))
  node.textContent = copy.notice;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
retry.textContent = copy.retry;
// A fresh document also disposes all shared WebApp listeners after a failed boot.
retry.addEventListener("click", () => location.reload());
void mountMarketApp({
  document,
  transport: catalogTransport(),
  host: {
    locale: () => locale,
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    onViewportChanged: (callback) => {
      window.addEventListener("resize", callback);
    },
    selectionFeedback: () => {},
  },
}).catch(() => {
  document.querySelector("#status")!.textContent = copy.failed;
  document.querySelector("#snapshot")!.textContent = "";
  retry.hidden = false;
});
