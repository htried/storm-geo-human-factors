import { describe, expect, it } from "vitest";

import { createPreviewToken, verifyPreviewToken } from "./preview-token";

describe("preview token", () => {
  it("mints and verifies a valid token", () => {
    const token = createPreviewToken({
      participantId: "p1",
      condition: "injected_agent",
      secret: "admin-secret",
      expiresAtUnixSec: 2_000_000_000,
    });
    expect(
      verifyPreviewToken({
        participantId: "p1",
        condition: "injected_agent",
        secret: "admin-secret",
        token,
        nowUnixSec: 1_900_000_000,
      }),
    ).toBe(true);
  });

  it("rejects mismatched participant/condition/expiry", () => {
    const token = createPreviewToken({
      participantId: "p1",
      condition: "injected_agent",
      secret: "admin-secret",
      expiresAtUnixSec: 2_000_000_000,
    });
    expect(
      verifyPreviewToken({
        participantId: "p2",
        condition: "injected_agent",
        secret: "admin-secret",
        token,
        nowUnixSec: 1_900_000_000,
      }),
    ).toBe(false);
    expect(
      verifyPreviewToken({
        participantId: "p1",
        condition: "vanilla_agent",
        secret: "admin-secret",
        token,
        nowUnixSec: 1_900_000_000,
      }),
    ).toBe(false);
    expect(
      verifyPreviewToken({
        participantId: "p1",
        condition: "injected_agent",
        secret: "admin-secret",
        token,
        nowUnixSec: 2_100_000_000,
      }),
    ).toBe(false);
  });
});
