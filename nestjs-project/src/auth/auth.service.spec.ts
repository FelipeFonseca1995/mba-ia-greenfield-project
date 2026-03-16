import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { ChannelsService } from '../channels/channels.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';

jest.mock('bcrypt');
jest.mock('uuid', () => ({ v4: () => 'mock-uuid-token' }));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let channelsService: jest.Mocked<Partial<ChannelsService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let mailService: jest.Mocked<Partial<MailService>>;

  const mockUser: Partial<User> = {
    id: 'user-uuid',
    email: 'test@example.com',
    password: 'hashed-password',
    isEmailConfirmed: true,
    emailConfirmationToken: null,
    emailConfirmationTokenExpiresAt: null,
    passwordResetToken: null,
    passwordResetTokenExpiresAt: null,
    refreshToken: 'hashed-refresh-token',
  };

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findByEmailConfirmationToken: jest.fn(),
      findByPasswordResetToken: jest.fn(),
      update: jest.fn(),
    };

    channelsService = {
      create: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn(),
    };

    mailService = {
      sendEmailConfirmation: jest.fn(),
      sendPasswordReset: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                JWT_ACCESS_SECRET: 'access-secret',
                JWT_ACCESS_EXPIRATION: '15m',
                JWT_REFRESH_SECRET: 'refresh-secret',
                JWT_REFRESH_EXPIRATION: '7d',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      usersService.findByEmail!.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      usersService.create!.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@example.com',
      } as User);
      channelsService.create!.mockResolvedValue({} as any);
      mailService.sendEmailConfirmation!.mockResolvedValue(undefined);

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(usersService.create).toHaveBeenCalled();
      expect(channelsService.create).toHaveBeenCalledWith({
        name: 'test',
        userId: 'user-uuid',
      });
      expect(mailService.sendEmailConfirmation).toHaveBeenCalledWith(
        'test@example.com',
        'mock-uuid-token',
      );
      expect(result.message).toContain('Registration successful');
    });

    it('should throw ConflictException if email already exists', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as User);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('validateUser', () => {
    it('should return user without password for valid credentials', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(
        'test@example.com',
        'password123',
      );

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password');
      expect(result!.email).toBe('test@example.com');
    });

    it('should return null for wrong password', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(
        'test@example.com',
        'wrong-password',
      );

      expect(result).toBeNull();
    });

    it('should return null for non-existent email', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      const result = await service.validateUser(
        'nonexistent@example.com',
        'password123',
      );

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return tokens for confirmed user', async () => {
      jwtService.signAsync!.mockResolvedValueOnce('access-token');
      jwtService.signAsync!.mockResolvedValueOnce('refresh-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');

      const result = await service.login({
        id: 'user-uuid',
        email: 'test@example.com',
        isEmailConfirmed: true,
      });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(usersService.update).toHaveBeenCalledWith('user-uuid', {
        refreshToken: 'hashed-refresh',
      });
    });

    it('should throw ForbiddenException for unconfirmed email', async () => {
      await expect(
        service.login({
          id: 'user-uuid',
          email: 'test@example.com',
          isEmailConfirmed: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('logout', () => {
    it('should clear refresh token', async () => {
      usersService.update!.mockResolvedValue(undefined);

      const result = await service.logout('user-uuid');

      expect(usersService.update).toHaveBeenCalledWith('user-uuid', {
        refreshToken: null,
      });
      expect(result.message).toBe('Logged out successfully');
    });
  });

  describe('confirmEmail', () => {
    it('should confirm email with valid token', async () => {
      const userWithToken = {
        ...mockUser,
        isEmailConfirmed: false,
        emailConfirmationToken: 'valid-token',
        emailConfirmationTokenExpiresAt: new Date(Date.now() + 100000),
      };
      usersService.findByEmailConfirmationToken!.mockResolvedValue(
        userWithToken as User,
      );

      const result = await service.confirmEmail('valid-token');

      expect(usersService.update).toHaveBeenCalledWith('user-uuid', {
        isEmailConfirmed: true,
        emailConfirmationToken: null,
        emailConfirmationTokenExpiresAt: null,
      });
      expect(result.message).toBe('Email confirmed successfully');
    });

    it('should throw BadRequestException for invalid token', async () => {
      usersService.findByEmailConfirmationToken!.mockResolvedValue(null);

      await expect(service.confirmEmail('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for expired token', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        isEmailConfirmed: false,
        emailConfirmationToken: 'expired-token',
        emailConfirmationTokenExpiresAt: new Date(Date.now() - 100000),
      };
      usersService.findByEmailConfirmationToken!.mockResolvedValue(
        userWithExpiredToken as User,
      );

      await expect(service.confirmEmail('expired-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if already confirmed', async () => {
      const confirmedUser = {
        ...mockUser,
        isEmailConfirmed: true,
        emailConfirmationToken: 'token',
      };
      usersService.findByEmailConfirmationToken!.mockResolvedValue(
        confirmedUser as User,
      );

      await expect(service.confirmEmail('token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resendConfirmation', () => {
    it('should resend confirmation email', async () => {
      const unconfirmedUser = { ...mockUser, isEmailConfirmed: false };
      usersService.findByEmail!.mockResolvedValue(unconfirmedUser as User);
      mailService.sendEmailConfirmation!.mockResolvedValue(undefined);

      const result = await service.resendConfirmation('test@example.com');

      expect(usersService.update).toHaveBeenCalled();
      expect(mailService.sendEmailConfirmation).toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should return silently if user does not exist', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      const result = await service.resendConfirmation(
        'nonexistent@example.com',
      );

      expect(mailService.sendEmailConfirmation).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should return silently if email already confirmed', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as User);

      const result = await service.resendConfirmation('test@example.com');

      expect(mailService.sendEmailConfirmation).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('requestPasswordReset', () => {
    it('should send password reset email', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as User);
      mailService.sendPasswordReset!.mockResolvedValue(undefined);

      const result = await service.requestPasswordReset('test@example.com');

      expect(usersService.update).toHaveBeenCalled();
      expect(mailService.sendPasswordReset).toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should return silently if user does not exist', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      const result = await service.requestPasswordReset(
        'nonexistent@example.com',
      );

      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully', async () => {
      const userWithResetToken = {
        ...mockUser,
        passwordResetToken: 'valid-token',
        passwordResetTokenExpiresAt: new Date(Date.now() + 100000),
      };
      usersService.findByPasswordResetToken!.mockResolvedValue(
        userWithResetToken as User,
      );
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      const result = await service.resetPassword('valid-token', 'newpassword');

      expect(usersService.update).toHaveBeenCalledWith('user-uuid', {
        password: 'new-hashed-password',
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
        refreshToken: null,
      });
      expect(result.message).toBe('Password reset successfully');
    });

    it('should throw BadRequestException for invalid token', async () => {
      usersService.findByPasswordResetToken!.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalid-token', 'newpassword'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired token', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        passwordResetToken: 'expired-token',
        passwordResetTokenExpiresAt: new Date(Date.now() - 100000),
      };
      usersService.findByPasswordResetToken!.mockResolvedValue(
        userWithExpiredToken as User,
      );

      await expect(
        service.resetPassword('expired-token', 'newpassword'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshTokens', () => {
    it('should return new tokens for valid refresh token', async () => {
      usersService.findById!.mockResolvedValue(mockUser as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync!.mockResolvedValueOnce('new-access-token');
      jwtService.signAsync!.mockResolvedValueOnce('new-refresh-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-refresh');

      const result = await service.refreshTokens('user-uuid', 'valid-refresh');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      usersService.findById!.mockResolvedValue(null);

      await expect(
        service.refreshTokens('nonexistent', 'token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if no stored refresh token', async () => {
      usersService.findById!.mockResolvedValue({
        ...mockUser,
        refreshToken: null,
      } as User);

      await expect(service.refreshTokens('user-uuid', 'token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if refresh token does not match', async () => {
      usersService.findById!.mockResolvedValue(mockUser as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.refreshTokens('user-uuid', 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
