// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FailureReport } from "@nilx-one/application";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemInformerProvider } from "../system-informer/system-informer";
import { chooseLocale } from "../../shell/localization";
import {
  ToastViewport,
  ToastViewportProvider,
} from "../../shell/toast-viewport";
import {
  FailureNoticeProvider,
  usePublishFailure,
  type PublishFailureOptions,
} from "./failure-toast-region";

interface ProducerProps {
  readonly report: FailureReport;
  readonly options?: PublishFailureOptions;
}

function Producer({ report, options }: ProducerProps) {
  const publish = usePublishFailure();

  return (
    <button type="button" onClick={() => publish(report, options)}>
      Publish failure
    </button>
  );
}

function renderProducer(props: ProducerProps) {
  return render(
    <FailureNoticeProvider>
      <Producer {...props} />
    </FailureNoticeProvider>,
  );
}

afterEach(() => {
  chooseLocale("auto");
  window.localStorage.clear();
});

describe("FailureNoticeProvider", () => {
  it("keeps a labelled live region mounted before any failure arrives", () => {
    render(
      <FailureNoticeProvider>
        <p>Content</p>
      </FailureNoticeProvider>,
    );

    expect(
      screen.getByRole("region", { name: "Failure notices" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("requests one light host impact for a newly published failure without repeating on rerender", async () => {
    const user = userEvent.setup();
    const impact = vi.fn();
    const report: FailureReport = {
      code: "contract_rejected",
      kind: "rejected",
      retryable: false,
    };
    const options: PublishFailureOptions = { feedback: { impact } };
    const view = renderProducer({ report, options });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(impact).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledWith("light");

    view.rerender(
      <FailureNoticeProvider>
        <Producer report={report} options={options} />
      </FailureNoticeProvider>,
    );

    expect(impact).toHaveBeenCalledOnce();
  });

  it("keeps the failure visible when host feedback itself fails", async () => {
    const user = userEvent.setup();
    const impact = vi.fn(() => {
      throw new Error("haptics unavailable");
    });

    renderProducer({
      report: {
        code: "contract_rejected",
        kind: "rejected",
        retryable: false,
      },
      options: { feedback: { impact } },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(impact).toHaveBeenCalledOnce();
    expect(screen.getByText("Request rejected")).toBeInTheDocument();
  });

  it("marks a newly published failure with the host's failure cue", async () => {
    const user = userEvent.setup();
    const sound = {
      supported: true,
      play: vi.fn(() => {
        throw new Error("no audio device");
      }),
      setEnabled: vi.fn(),
      setAmbience: vi.fn(),
      speak: vi.fn(),
    };
    render(
      <FailureNoticeProvider sound={sound}>
        <Producer
          report={{
            code: "contract_rejected",
            kind: "rejected",
            retryable: false,
          }}
        />
      </FailureNoticeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(sound.play).toHaveBeenCalledOnce();
    expect(sound.play).toHaveBeenCalledWith("failure");
    // A cue that fails is a cue not heard; the notice is still there.
    expect(screen.getByText("Request rejected")).toBeInTheDocument();
  });

  it("puts an unavailable report on screen with the retry the caller can honour", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    renderProducer({
      report: {
        code: "inference_unavailable",
        kind: "unavailable",
        retryable: true,
        operation_id: "op-71c",
      },
      options: { onRetry },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(screen.getByText("Request unanswered")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText("Request unanswered")).toBeNull();
  });

  it("renders an existing semantic failure in the selected frontend locale", async () => {
    chooseLocale("uk-UA");
    const user = userEvent.setup();

    renderProducer({
      report: {
        code: "inference_unavailable",
        kind: "unavailable",
        retryable: true,
      },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(screen.getByText("Запит без відповіді")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Сповіщення про помилки" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("uk-UA");
  });

  it("never offers to ask an authority the same question twice", async () => {
    const user = userEvent.setup();

    renderProducer({
      report: {
        code: "authority_withheld",
        kind: "withheld",
        retryable: false,
      },
      options: { onRetry: () => undefined },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(screen.getByText("Declined by authority")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("withholds a retry affordance when no producer can reissue the operation", async () => {
    const user = userEvent.setup();

    renderProducer({
      report: {
        code: "inference_unavailable",
        kind: "unavailable",
        retryable: true,
      },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    expect(screen.getByText("Request unanswered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps correlation handles behind the reference disclosure", async () => {
    const user = userEvent.setup();

    renderProducer({
      report: {
        code: "contract_rejected",
        kind: "rejected",
        retryable: false,
        operation_id: "op-71c",
        session_id: "se-40b",
      },
    });

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    const disclosure = screen.getByText("Reference").closest("details");

    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent(
      "code contract_rejected · operation op-71c · session se-40b",
    );
  });

  it("dismisses only the notice a person closed", async () => {
    const user = userEvent.setup();

    renderProducer({
      report: {
        code: "budget_exhausted",
        kind: "exhausted",
        retryable: false,
      },
    });

    const publish = screen.getByRole("button", { name: "Publish failure" });
    await user.click(publish);
    await user.click(publish);

    expect(screen.getAllByText("Limit reached")).toHaveLength(2);

    await user.click(
      screen.getAllByRole("button", { name: "Dismiss: Limit reached" })[0]!,
    );

    expect(screen.getAllByText("Limit reached")).toHaveLength(1);
  });

  it("joins the shell's single toast stack instead of opening a second one", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ToastViewportProvider>
        <FailureNoticeProvider>
          <Producer
            report={{
              code: "authority_withheld",
              kind: "withheld",
              retryable: false,
            }}
          />
          <ToastViewport />
        </FailureNoticeProvider>
      </ToastViewportProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Publish failure" }));

    const stack = container.querySelector(".app-shell__notices");
    expect(stack?.querySelector(".toast-region--inline")).not.toBeNull();
    expect(stack?.textContent?.includes("Declined by authority")).toBe(true);
    expect(container.querySelectorAll(".toast-region")).toHaveLength(1);
  });

  it("refuses to publish without a provider rather than swallowing the failure", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() =>
      render(
        <Producer
          report={{
            code: "authority_withheld",
            kind: "withheld",
            retryable: false,
          }}
        />,
      ),
    ).toThrow("usePublishFailure requires a FailureNoticeProvider ancestor");

    consoleError.mockRestore();
  });
});

it("delivers a failure through xPing once and retains the real retry action", async () => {
  chooseLocale("en");
  const user = userEvent.setup();
  const onRetry = vi.fn();
  render(
    <SystemInformerProvider>
      <FailureNoticeProvider>
        <Producer
          report={{
            code: "inference_unavailable",
            kind: "unavailable",
            retryable: true,
            operation_id: "op-71c",
          }}
          options={{ onRetry }}
        />
      </FailureNoticeProvider>
    </SystemInformerProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Publish failure" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Request unanswered");
  expect(screen.queryByText("xPing: Request unanswered")).toBeNull();
  await user.click(screen.getByText("(skip)"));
  expect(screen.getAllByText("xPing: Request unanswered")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.getByText("xPing: Request unanswered")).toBeInTheDocument();
});

it("announces repeated and retried failures once, refreshing the receipt with each async failure", async () => {
  chooseLocale("en");
  const user = userEvent.setup();
  let attempts = 0;
  function RetryingProducer() {
    const publish = usePublishFailure();
    function fail() {
      attempts += 1;
      publish(
        {
          code: "inference_unavailable",
          kind: "unavailable",
          retryable: true,
          session_id: "s1",
          operation_id: `op-${attempts}`,
        },
        {
          onRetry: () => {
            void Promise.resolve().then(fail);
          },
        },
      );
    }
    return <button onClick={fail}>Fail</button>;
  }
  render(
    <SystemInformerProvider>
      <FailureNoticeProvider>
        <RetryingProducer />
      </FailureNoticeProvider>
    </SystemInformerProvider>,
  );
  await user.click(screen.getByText("Fail"));
  await user.click(screen.getByText("Fail"));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await user.click(screen.getByText("Understood"));
  for (const op of [3, 4]) {
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(
        `code inference_unavailable · operation op-${op} · session s1`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("xPing: Request unanswered")).toHaveLength(1);
  }
  await user.click(
    screen.getByRole("button", { name: "Dismiss: xPing: Request unanswered" }),
  );
  await user.click(screen.getByText("Fail"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
