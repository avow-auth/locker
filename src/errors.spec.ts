import { LockerError, LockNotGrantedError } from "./errors";

describe("errors", () => {
  test("LockNotGrantedError should be instance of self and LockerError", () => {
    for (const errorClass of [LockNotGrantedError, LockerError]) {
      expect(() => {
        throw new LockNotGrantedError("lock not granted");
      }).toThrow(errorClass);
    }
});
});