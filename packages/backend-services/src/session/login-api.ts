import type { EngineStateDto } from '../types';
import { readJsonBody } from './http';
import type { LoginFlow } from './login-flow';
import { requirePhone, requireText } from './params';

/**
 * The login surface of the bridge: start (or join) a sign-in, feed it the code
 * and password it asks for, drop it. Kept out of `engine.ts` so the wake/live
 * lifecycle there stays readable.
 */
export class LoginApi {
  constructor(
    private readonly login: LoginFlow,
    private readonly snapshot: () => Promise<EngineStateDto>,
  ) {}

  async startQr(): Promise<EngineStateDto> {
    await this.login.startQr();
    return this.snapshot();
  }

  async startPhone(request: Request): Promise<EngineStateDto> {
    const body = await readJsonBody(request);
    await this.login.startPhone(requirePhone(body.phone));
    return this.snapshot();
  }

  async submitCode(request: Request): Promise<EngineStateDto> {
    const body = await readJsonBody(request);
    this.login.submitCode(requireText(body.code, 16));
    return this.snapshot();
  }

  async submitPassword(request: Request): Promise<EngineStateDto> {
    const body = await readJsonBody(request);
    this.login.submitPassword(requireText(body.password, 256));
    return this.snapshot();
  }

  async cancel(): Promise<EngineStateDto> {
    this.login.cancel();
    return this.snapshot();
  }
}
