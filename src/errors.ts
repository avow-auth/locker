export class LockerError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = (<any>this).constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LeaseNotGrantedError extends LockerError { };
