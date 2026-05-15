import { describe, expect, it } from "vitest";
import { readActiveApp } from "../src/xml.js";

describe("XML helpers", () => {
  it("reads active-app responses with attributes", () => {
    expect(
      readActiveApp(
        '<active-app><app id="dev" type="appl" version="1.0">put.io</app></active-app>',
      ),
    ).toEqual({
      id: "dev",
      name: "put.io",
      type: "appl",
      version: "1.0",
    });
  });

  it("reads active-app responses without attributes", () => {
    expect(readActiveApp("<active-app><app>Roku</app></active-app>")).toEqual({
      id: "",
      name: "Roku",
      type: "",
      version: "",
    });
  });
});
