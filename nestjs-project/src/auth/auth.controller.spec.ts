import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      confirmEmail: jest.fn(),
      resendConfirmation: jest.fn(),
      login: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call authService.register', async () => {
      const dto = { email: 'test@example.com', password: 'password123' };
      authService.register!.mockResolvedValue({ message: 'ok' });

      await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('confirmEmail', () => {
    it('should call authService.confirmEmail', async () => {
      authService.confirmEmail!.mockResolvedValue({ message: 'ok' });

      await controller.confirmEmail({ token: 'token-123' });

      expect(authService.confirmEmail).toHaveBeenCalledWith('token-123');
    });
  });

  describe('resendConfirmation', () => {
    it('should call authService.resendConfirmation', async () => {
      authService.resendConfirmation!.mockResolvedValue({ message: 'ok' });

      await controller.resendConfirmation({ email: 'test@example.com' });

      expect(authService.resendConfirmation).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });

  describe('login', () => {
    it('should call authService.login with user from guard', async () => {
      const user = {
        id: 'uuid',
        email: 'test@example.com',
        isEmailConfirmed: true,
      };
      authService.login!.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      await controller.login(user);

      expect(authService.login).toHaveBeenCalledWith(user);
    });
  });

  describe('refreshTokens', () => {
    it('should call authService.refreshTokens', async () => {
      const user = { id: 'uuid', refreshToken: 'rt' };
      authService.refreshTokens!.mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });

      await controller.refreshTokens(user);

      expect(authService.refreshTokens).toHaveBeenCalledWith('uuid', 'rt');
    });
  });

  describe('logout', () => {
    it('should call authService.logout', async () => {
      authService.logout!.mockResolvedValue({ message: 'ok' });

      await controller.logout({ id: 'uuid' });

      expect(authService.logout).toHaveBeenCalledWith('uuid');
    });
  });

  describe('requestPasswordReset', () => {
    it('should call authService.requestPasswordReset', async () => {
      authService.requestPasswordReset!.mockResolvedValue({ message: 'ok' });

      await controller.requestPasswordReset({ email: 'test@example.com' });

      expect(authService.requestPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });

  describe('resetPassword', () => {
    it('should call authService.resetPassword', async () => {
      authService.resetPassword!.mockResolvedValue({ message: 'ok' });

      await controller.resetPassword({
        token: 'token-123',
        password: 'newpassword',
      });

      expect(authService.resetPassword).toHaveBeenCalledWith(
        'token-123',
        'newpassword',
      );
    });
  });
});
