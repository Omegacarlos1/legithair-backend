export interface EmailMessage { to: string; template: 'verification' | 'password_reset'; token: string }
export interface EmailProvider { send(message: EmailMessage): Promise<void> }

export class FakeEmailProvider implements EmailProvider {
  public readonly deliveries: EmailMessage[] = [];
  public async send(message: EmailMessage): Promise<void> { this.deliveries.push(structuredClone(message)); }
}
