import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    channelRepository = dataSource.getRepository(Channel);
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  const createTestChannel = async (
    email: string,
    nickname: string,
  ): Promise<Channel> => {
    const user = userRepository.create({
      email,
      password: 'hashedpassword',
    });
    const savedUser = await userRepository.save(user);

    const channel = channelRepository.create({
      name: 'Test Channel',
      nickname,
      user_id: savedUser.id,
    });
    return channelRepository.save(channel);
  };

  it('should auto-generate uuid, created_at, and updated_at', async () => {
    const channel = await createTestChannel('test1@example.com', 'nick1');
    const video = videoRepository.create({
      slug: 'slug1234567',
      title: 'Test Video',
      channel_id: channel.id,
    });
    const saved = await videoRepository.save(video);

    expect(saved.id).toBeDefined();
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('should default status to DRAFT', async () => {
    const channel = await createTestChannel('test2@example.com', 'nick2');
    const video = videoRepository.create({
      slug: 'slugdefault',
      title: 'Default Status Video',
      channel_id: channel.id,
    });
    const saved = await videoRepository.save(video);

    expect(saved.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce unique slug constraint', async () => {
    const channel = await createTestChannel('test3@example.com', 'nick3');
    await videoRepository.save(
      videoRepository.create({
        slug: 'dupslug',
        title: 'Video 1',
        channel_id: channel.id,
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          slug: 'dupslug',
          title: 'Video 2',
          channel_id: channel.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should cascade delete when channel is deleted', async () => {
    const channel = await createTestChannel('test4@example.com', 'nick4');
    const video = videoRepository.create({
      slug: 'slugcascade',
      title: 'Video to Delete',
      channel_id: channel.id,
    });
    await videoRepository.save(video);

    await channelRepository.delete(channel.id);

    const found = await videoRepository.findOneBy({ slug: 'slugcascade' });
    expect(found).toBeNull();
  });
});
