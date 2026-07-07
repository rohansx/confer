import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const full = {
  APP_ORIGIN: "a",
  VIEW_ORIGIN: "v",
  DB_PATH: "d",
  BLOB_DIR: "b",
  SIGNING_SECRET: "s",
};

describe("loadConfig", () => {
  it("parses a full env", () => {
    expect(loadConfig(full)).toEqual({
      appOrigin: "a",
      viewOrigin: "v",
      dbPath: "d",
      blobDir: "b",
      signingSecret: "s",
    });
  });

  it("throws when a required var is missing", () => {
    expect(() => loadConfig({ ...full, SIGNING_SECRET: undefined })).toThrow(
      /SIGNING_SECRET/,
    );
  });
});
