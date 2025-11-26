import { Strategy as PassportStrategy } from 'passport';

export interface StrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  scope?: string[];
  tenant?: string;
}

export interface Profile {
  id: string;
  displayName?: string;
  emails?: Array<{ value: string }>;
}

export type VerifyCallback = (
  accessToken: string,
  refreshToken: string,
  profile: Profile,
  done: (error: Error | null, user?: Express.User) => void
) => void;

export class Strategy extends PassportStrategy {
  name: string = 'microsoft';
  
  private options: StrategyOptions;
  private verify: VerifyCallback;

  constructor(options: StrategyOptions, verify: VerifyCallback) {
    super();
    this.options = options;
    this.verify = verify;
  }

  authenticate(req: Express.Request, _options?: object): void {
    this.fail({ message: 'Microsoft OAuth not implemented' });
  }
}
