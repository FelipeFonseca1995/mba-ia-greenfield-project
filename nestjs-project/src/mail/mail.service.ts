import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private appUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
  }

  async sendEmailConfirmation(email: string, token: string): Promise<void> {
    const confirmationUrl = `${this.appUrl}/auth/confirm-email?token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'StreamTube - Confirm your email',
      template: 'email-confirmation',
      context: {
        email,
        confirmationUrl,
      },
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${this.appUrl}/auth/reset-password?token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'StreamTube - Reset your password',
      template: 'password-reset',
      context: {
        email,
        resetUrl,
      },
    });
  }
}
