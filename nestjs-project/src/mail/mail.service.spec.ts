import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let mailerService: jest.Mocked<Partial<MailerService>>;

  beforeEach(async () => {
    mailerService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: mailerService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmailConfirmation', () => {
    it('should send confirmation email with correct params', async () => {
      await service.sendEmailConfirmation('test@example.com', 'token-123');

      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'StreamTube - Confirm your email',
        template: 'email-confirmation',
        context: {
          email: 'test@example.com',
          confirmationUrl:
            'http://localhost:3000/auth/confirm-email?token=token-123',
        },
      });
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email with correct params', async () => {
      await service.sendPasswordReset('test@example.com', 'reset-token-123');

      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'StreamTube - Reset your password',
        template: 'password-reset',
        context: {
          email: 'test@example.com',
          resetUrl:
            'http://localhost:3000/auth/reset-password?token=reset-token-123',
        },
      });
    });
  });
});
