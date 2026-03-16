import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import type { StringValue } from 'ms';
import { UsersService } from '../users/users.service';
import { ChannelsService } from '../channels/channels.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly channelsService: ChannelsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const emailConfirmationToken = uuidv4();
    const emailConfirmationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    const user = await this.usersService.create({
      email: dto.email,
      password: hashedPassword,
      emailConfirmationToken,
      emailConfirmationTokenExpiresAt,
    });

    const channelName = dto.email.split('@')[0];
    await this.channelsService.create({
      name: channelName,
      userId: user.id,
    });

    await this.mailService.sendEmailConfirmation(
      user.email,
      emailConfirmationToken,
    );

    return {
      message:
        'Registration successful. Please check your email to confirm your account.',
    };
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersService.findByEmail(email.toLowerCase());
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...result } = user;
    return result;
  }

  async login(user: {
    id: string;
    email: string;
    isEmailConfirmed: boolean;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    if (!user.isEmailConfirmed) {
      throw new ForbiddenException(
        'Please confirm your email before logging in',
      );
    }

    const tokens = await this.generateTokens(user.id, user.email);
    const hashedRefreshToken = await bcrypt.hash(
      tokens.refreshToken,
      SALT_ROUNDS,
    );
    await this.usersService.update(user.id, {
      refreshToken: hashedRefreshToken,
    });

    return tokens;
  }

  async logout(userId: string): Promise<{ message: string }> {
    await this.usersService.update(userId, { refreshToken: null });
    return { message: 'Logged out successfully' };
  }

  async confirmEmail(token: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailConfirmationToken(token);

    if (!user) {
      throw new BadRequestException('Invalid confirmation token');
    }

    if (user.isEmailConfirmed) {
      throw new BadRequestException('Email already confirmed');
    }

    if (
      user.emailConfirmationTokenExpiresAt &&
      user.emailConfirmationTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Confirmation token has expired');
    }

    await this.usersService.update(user.id, {
      isEmailConfirmed: true,
      emailConfirmationToken: null,
      emailConfirmationTokenExpiresAt: null,
    });

    return { message: 'Email confirmed successfully' };
  }

  async resendConfirmation(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email.toLowerCase());

    if (!user || user.isEmailConfirmed) {
      return {
        message:
          'If the email exists and is not confirmed, a confirmation email has been sent.',
      };
    }

    const emailConfirmationToken = uuidv4();
    const emailConfirmationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    await this.usersService.update(user.id, {
      emailConfirmationToken,
      emailConfirmationTokenExpiresAt,
    });

    await this.mailService.sendEmailConfirmation(
      user.email,
      emailConfirmationToken,
    );

    return {
      message:
        'If the email exists and is not confirmed, a confirmation email has been sent.',
    };
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email.toLowerCase());

    if (!user) {
      return {
        message: 'If the email exists, a password reset link has been sent.',
      };
    }

    const passwordResetToken = uuidv4();
    const passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.usersService.update(user.id, {
      passwordResetToken,
      passwordResetTokenExpiresAt,
    });

    await this.mailService.sendPasswordReset(user.email, passwordResetToken);

    return {
      message: 'If the email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByPasswordResetToken(token);

    if (!user) {
      throw new BadRequestException('Invalid reset token');
    }

    if (
      user.passwordResetTokenExpiresAt &&
      user.passwordResetTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Reset token has expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.usersService.update(user.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      refreshToken: null,
    });

    return { message: 'Password reset successfully' };
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findById(userId);

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    const isRefreshTokenValid = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );

    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Access denied');
    }

    const tokens = await this.generateTokens(user.id, user.email);
    const hashedRefreshToken = await bcrypt.hash(
      tokens.refreshToken,
      SALT_ROUNDS,
    );
    await this.usersService.update(user.id, {
      refreshToken: hashedRefreshToken,
    });

    return tokens;
  }

  private async generateTokens(
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET')!;
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET')!;
    const accessExpiration = this.configService.get<string>(
      'JWT_ACCESS_EXPIRATION',
      '15m',
    ) as StringValue;
    const refreshExpiration = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    ) as StringValue;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email },
        {
          secret: accessSecret,
          expiresIn: accessExpiration,
        },
      ),
      this.jwtService.signAsync(
        { sub: userId },
        {
          secret: refreshSecret,
          expiresIn: refreshExpiration,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
