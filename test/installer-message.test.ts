import { describe, expect, it } from "vite-plus/test";
import { isDeleteSuccess, isEmptyDeveloperSlotMessage } from "../src/installer-message.js";

describe("installer message classification", () => {
  it("recognizes both empty developer-slot phrasings", () => {
    expect(isEmptyDeveloperSlotMessage("No plugin installed")).toBe(true);
    // Older devices fail a delete/replace of an empty slot this way.
    expect(isEmptyDeveloperSlotMessage("Delete Failed: No such file or directory")).toBe(true);
    expect(isEmptyDeveloperSlotMessage("Some unrelated installer message")).toBe(false);
  });

  it("treats delete success and empty-slot deletes as success, rejects real failures", () => {
    expect(isDeleteSuccess("Delete Succeeded.")).toBe(true);
    expect(isDeleteSuccess("Delete Failed: No such file or directory")).toBe(true);
    expect(isDeleteSuccess("No plugin installed")).toBe(true);
    expect(isDeleteSuccess("Install Failure: compilation failed")).toBe(false);
    expect(isDeleteSuccess("Empty Roku installer response")).toBe(false);
  });
});
