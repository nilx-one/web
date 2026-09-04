// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FailureReport } from "@nilx-one/application";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
      report: { code: "budget_exhausted", kind: "exhausted", retryable: false },
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
