// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readBgFastPath } from "./preferences";

const KIND_KEY = "YaMet-ui-bg-kind-shadow";
const IMAGE_ID_KEY = "YaMet-ui-bg-image-shadow";

describe("readBgFastPath", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns inactive when no state stored", () => {
    expect(readBgFastPath()).toEqual({ active: false, imageId: null });
  });

  it("reads active image background", () => {
    window.localStorage.setItem(KIND_KEY, "image");
    window.localStorage.setItem(IMAGE_ID_KEY, "abc123");
    expect(readBgFastPath()).toEqual({
      active: true,
      imageId: "abc123",
    });
  });

  it("returns inactive for non-image kind", () => {
    window.localStorage.setItem(KIND_KEY, "color");
    window.localStorage.setItem(IMAGE_ID_KEY, "abc");
    expect(readBgFastPath().active).toBe(false);
  });

  it("returns inactive when imageId missing", () => {
    window.localStorage.setItem(KIND_KEY, "image");
    expect(readBgFastPath()).toEqual({ active: false, imageId: null });
  });
});
