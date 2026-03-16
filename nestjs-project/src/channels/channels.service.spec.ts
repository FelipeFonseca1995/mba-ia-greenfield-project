import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';

describe('ChannelsService', () => {
  let service: ChannelsService;
  let repository: jest.Mocked<Partial<Repository<Channel>>>;

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        {
          provide: getRepositoryToken(Channel),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<ChannelsService>(ChannelsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save a channel', async () => {
      const channelData: Partial<Channel> = {
        name: 'testuser',
        userId: 'user-uuid',
      };
      const channel = { id: 'channel-uuid', ...channelData } as Channel;
      (repository.create as jest.Mock).mockReturnValue(channel);
      (repository.save as jest.Mock).mockResolvedValue(channel);

      const result = await service.create(channelData);

      expect(repository.create).toHaveBeenCalledWith(channelData);
      expect(repository.save).toHaveBeenCalledWith(channel);
      expect(result).toEqual(channel);
    });
  });

  describe('findByUserId', () => {
    it('should find channel by userId', async () => {
      const channel = { id: 'channel-uuid', userId: 'user-uuid' } as Channel;
      (repository.findOne as jest.Mock).mockResolvedValue(channel);

      const result = await service.findByUserId('user-uuid');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
      });
      expect(result).toEqual(channel);
    });

    it('should return null if channel not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.findByUserId('nonexistent');

      expect(result).toBeNull();
    });
  });
});
