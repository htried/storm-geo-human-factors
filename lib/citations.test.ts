import { describe, expect, it } from "vitest";
import { linkifyCitations } from "./citations";

const cites = [
  { n: 1, url: "https://a.example/1", title: "A" },
  { n: 12, url: "https://b.example/12", title: "B" },
];

describe("linkifyCitations", () => {
  it("turns [n] markers into citation links", () => {
    expect(linkifyCitations("Fact[1][12].", cites)).toBe(
      'Fact[[1]](https://a.example/1 "citation")[[12]](https://b.example/12 "citation").',
    );
  });

  it("leaves unknown numbers, existing links and ref definitions alone", () => {
    const md = "See [3] and [1](https://x.example) and\n[12]: https://y.example";
    expect(linkifyCitations(md, cites)).toBe(md);
  });

  it("is a no-op without citations", () => {
    expect(linkifyCitations("x[1]", [])).toBe("x[1]");
  });
});
