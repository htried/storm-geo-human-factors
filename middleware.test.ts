import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";

describe("middleware headers", () => {
  it("sets CSP + Referrer-Policy on /study and /ext", () => {
    process.env.ALLOWED_FRAME_ANCESTORS = "https://survey.example";
    const studyRes = middleware(
      new NextRequest("http://localhost/study?participant_id=p1"),
    );
    expect(studyRes.headers.get("content-security-policy")).toBe(
      "frame-ancestors https://survey.example;",
    );
    expect(studyRes.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );

    const extRes = middleware(new NextRequest("http://localhost/ext/t/s"));
    expect(extRes.headers.get("content-security-policy")).toBe(
      "frame-ancestors https://survey.example;",
    );
  });

  it("does not set these headers on unrelated paths", () => {
    const res = middleware(new NextRequest("http://localhost/api/session"));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("referrer-policy")).toBeNull();
  });
});
