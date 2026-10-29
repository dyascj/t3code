import { describe, expect, it } from "vite-plus/test";

import { focalBackgroundPosition } from "./focalPoint";

describe("focalBackgroundPosition", () => {
  // A 2:1 image covering a square frame is twice as wide as the frame.
  it("centers the focal point on the cropped axis as far as the image allows", () => {
    expect(focalBackgroundPosition({ x: 50, y: 50 }, 2, 100, 100)).toBe("50% 50%");
    expect(focalBackgroundPosition({ x: 40, y: 10 }, 2, 100, 100)).toBe("30% 50%");
    expect(focalBackgroundPosition({ x: 25, y: 50 }, 2, 100, 100)).toBe("0% 50%");
    expect(focalBackgroundPosition({ x: 100, y: 50 }, 2, 100, 100)).toBe("100% 50%");
  });

  it("moves vertically when the frame is wider than the image", () => {
    expect(focalBackgroundPosition({ x: 90, y: 60 }, 1, 200, 100)).toBe("50% 70%");
  });
});
