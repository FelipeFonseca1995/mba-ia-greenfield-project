import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({ type: 'boolean', default: false })
  isEmailConfirmed: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  emailConfirmationToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailConfirmationTokenExpiresAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  passwordResetToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordResetTokenExpiresAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  refreshToken: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => Channel, (channel) => channel.user)
  channel: Channel;
}
