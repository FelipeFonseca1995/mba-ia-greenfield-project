import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndChannels1710500000000 implements MigrationInterface {
  name = 'CreateUsersAndChannels1710500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password" varchar(255) NOT NULL,
        "isEmailConfirmed" boolean NOT NULL DEFAULT false,
        "emailConfirmationToken" varchar(255),
        "emailConfirmationTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "passwordResetToken" varchar(255),
        "passwordResetTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "refreshToken" varchar(255),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_emailConfirmationToken" UNIQUE ("emailConfirmationToken"),
        CONSTRAINT "UQ_users_passwordResetToken" UNIQUE ("passwordResetToken"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "channels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "nickname" varchar(100),
        "description" text,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_channels_userId" UNIQUE ("userId"),
        CONSTRAINT "PK_channels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_channels_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "channels"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
