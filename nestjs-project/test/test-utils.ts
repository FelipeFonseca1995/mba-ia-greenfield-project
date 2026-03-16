import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { ChannelsModule } from '../src/channels/channels.module';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { MailService } from '../src/mail/mail.service';
import { MailModule } from '../src/mail/mail.module';
import databaseConfig from '../src/config/database.config';
import jwtConfig from '../src/config/jwt.config';
import mailConfig from '../src/config/mail.config';

export class MockMailService {
  sentEmails: Array<{ to: string; type: string; token: string }> = [];

  sendEmailConfirmation(email: string, token: string): void {
    this.sentEmails.push({ to: email, type: 'confirmation', token });
  }

  sendPasswordReset(email: string, token: string): void {
    this.sentEmails.push({ to: email, type: 'reset', token });
  }

  getLastEmail() {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  clear() {
    this.sentEmails = [];
  }
}

export async function createTestApp(): Promise<{
  app: INestApplication;
  mailService: MockMailService;
}> {
  const mockMailService = new MockMailService();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [databaseConfig, jwtConfig, mailConfig],
        envFilePath: '.env',
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'streamtube',
        password: process.env.DB_PASSWORD || 'streamtube',
        database: process.env.DB_DATABASE || 'streamtube',
        autoLoadEntities: true,
        synchronize: true,
        dropSchema: true,
      }),
      AuthModule,
      UsersModule,
      ChannelsModule,
      MailModule,
    ],
    controllers: [AppController],
    providers: [
      AppService,
      {
        provide: APP_GUARD,
        useClass: JwtAuthGuard,
      },
    ],
  })
    .overrideProvider(MailService)
    .useValue(mockMailService)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return { app, mailService: mockMailService };
}
