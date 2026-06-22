import { describe, expect, it } from "vite-plus/test";
import { readActiveApp } from "../src/xml.js";

describe("XML helpers", () => {
  it("reads active-app responses with attributes", () => {
    expect(
      readActiveApp(
        '<active-app><app id="dev" type="appl" version="1.0">Example Channel</app></active-app>',
      ),
    ).toEqual({
      id: "dev",
      name: "Example Channel",
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
