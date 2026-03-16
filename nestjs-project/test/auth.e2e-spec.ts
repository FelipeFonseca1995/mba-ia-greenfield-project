import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, MockMailService } from './test-utils';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let mailService: MockMailService;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app as INestApplication<App>;
    mailService = testApp.mailService;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailService.clear();
  });

  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'Password123!',
  };

  describe('Full auth flow: register -> confirm -> login -> refresh -> logout', () => {
    let confirmationToken: string;
    let accessToken: string;
    let refreshToken: string;

    it('POST /auth/register - should register a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      expect(res.body.message).toContain('Registration successful');
      const lastEmail = mailService.getLastEmail();
      expect(lastEmail).toBeDefined();
      expect(lastEmail.type).toBe('confirmation');
      confirmationToken = lastEmail.token;
    });

    it('POST /auth/confirm-email - should confirm email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token: confirmationToken })
        .expect(200);

      expect(res.body.message).toBe('Email confirmed successfully');
    });

    it('POST /auth/login - should login and return tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send(testUser)
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('POST /auth/refresh - should refresh tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('POST /auth/logout - should logout', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.message).toBe('Logged out successfully');
    });

    it('POST /auth/refresh - should fail after logout', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(401);
    });
  });

  describe('Registration errors', () => {
    it('POST /auth/register - should reject duplicate email', async () => {
      const email = `dup-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Password123!' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Password123!' })
        .expect(409);
    });

    it('POST /auth/register - should reject invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'invalid', password: 'Password123!' })
        .expect(400);
    });

    it('POST /auth/register - should reject short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'short@example.com', password: '123' })
        .expect(400);
    });
  });

  describe('Login errors', () => {
    it('POST /auth/login - should reject unconfirmed email', async () => {
      const email = `unconfirmed-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Password123!' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(403);
    });

    it('POST /auth/login - should reject wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' })
        .expect(401);
    });

    it('POST /auth/login - should reject non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'Password123!' })
        .expect(401);
    });
  });

  describe('Email confirmation errors', () => {
    it('POST /auth/confirm-email - should reject invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token: 'invalid-token' })
        .expect(400);
    });
  });

  describe('Resend confirmation', () => {
    it('POST /auth/resend-confirmation - should return 200 even for non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/auth/resend-confirmation')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);
    });
  });

  describe('Password reset flow', () => {
    let resetToken: string;
    let resetEmail: string;

    beforeAll(async () => {
      resetEmail = `reset-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: resetEmail, password: 'Password123!' });

      const confirmToken = mailService.getLastEmail().token;
      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token: confirmToken });
      mailService.clear();
    });

    it('POST /auth/request-password-reset - should send reset email', async () => {
      await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: resetEmail })
        .expect(200);

      const lastEmail = mailService.getLastEmail();
      expect(lastEmail).toBeDefined();
      expect(lastEmail.type).toBe('reset');
      resetToken = lastEmail.token;
    });

    it('POST /auth/request-password-reset - should return 200 for non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);
    });

    it('POST /auth/reset-password - should reset password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, password: 'NewPassword456!' })
        .expect(200);

      expect(res.body.message).toBe('Password reset successfully');
    });

    it('POST /auth/login - should login with new password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: resetEmail, password: 'NewPassword456!' })
        .expect(200);
    });

    it('POST /auth/reset-password - should reject invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewPassword456!' })
        .expect(400);
    });
  });

  describe('DTO validation', () => {
    it('should reject missing fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({})
        .expect(400);
    });

    it('should reject extra fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          extra: 'field',
        })
        .expect(400);
    });
  });
});
