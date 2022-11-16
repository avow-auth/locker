import { LeaseNotGrantedError, LockerError } from "./errors";

describe("errors", () => {
  test("LockNotGrantedError should be instance of self and LockerError", () => {
    for (const errorClass of [LeaseNotGrantedError, LockerError]) {
      expect(() => {
        throw new LeaseNotGrantedError("lock not granted");
      }).toThrow(errorClass);
    }
});
});