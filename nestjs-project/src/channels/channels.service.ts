import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';

@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelsRepository: Repository<Channel>,
  ) {}

  async create(data: Partial<Channel>): Promise<Channel> {
    const channel = this.channelsRepository.create(data);
    return this.channelsRepository.save(channel);
  }

  async findByUserId(userId: string): Promise<Channel | null> {
    return this.channelsRepository.findOne({ where: { userId } });
  }
}
