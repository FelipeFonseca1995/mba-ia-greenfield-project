import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Partial<Repository<User>>>;

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save a user', async () => {
      const userData: Partial<User> = {
        email: 'test@example.com',
        password: 'hashed',
      };
      const user = { id: 'uuid', ...userData } as User;
      (repository.create as jest.Mock).mockReturnValue(user);
      (repository.save as jest.Mock).mockResolvedValue(user);

      const result = await service.create(userData);

      expect(repository.create).toHaveBeenCalledWith(userData);
      expect(repository.save).toHaveBeenCalledWith(user);
      expect(result).toEqual(user);
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      const user = { id: 'uuid', email: 'test@example.com' } as User;
      (repository.findOne as jest.Mock).mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.findByEmail('notfound@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const user = { id: 'uuid', email: 'test@example.com' } as User;
      (repository.findOne as jest.Mock).mockResolvedValue(user);

      const result = await service.findById('uuid');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('findByEmailConfirmationToken', () => {
    it('should find user by confirmation token', async () => {
      const user = { id: 'uuid', emailConfirmationToken: 'token' } as User;
      (repository.findOne as jest.Mock).mockResolvedValue(user);

      const result = await service.findByEmailConfirmationToken('token');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { emailConfirmationToken: 'token' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('findByPasswordResetToken', () => {
    it('should find user by password reset token', async () => {
      const user = { id: 'uuid', passwordResetToken: 'token' } as User;
      (repository.findOne as jest.Mock).mockResolvedValue(user);

      const result = await service.findByPasswordResetToken('token');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { passwordResetToken: 'token' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('update', () => {
    it('should update a user', async () => {
      (repository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.update('uuid', { isEmailConfirmed: true });

      expect(repository.update).toHaveBeenCalledWith('uuid', {
        isEmailConfirmed: true,
      });
    });
  });
});
