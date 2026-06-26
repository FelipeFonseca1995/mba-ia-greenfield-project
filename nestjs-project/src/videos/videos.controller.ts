import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';

import { VideosService } from './videos.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('upload/init')
  @HttpCode(HttpStatus.CREATED)
  async initUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitUploadDto,
  ) {
    return this.videosService.initiateVideoUpload(user.sub, dto);
  }

  @Post('upload/presign-parts')
  @HttpCode(HttpStatus.OK)
  async presignParts(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PresignPartsDto,
  ) {
    return this.videosService.generatePresignedParts(user.sub, dto);
  }

  @Post('upload/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeVideoUpload(user.sub, dto);
  }

  @Get(':slug')
  @Public()
  async getVideo(
    @Param('slug') slug: string,
    @Headers('authorization') authHeader?: string,
  ) {
    let userId: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
        userId = payload.sub;
      } catch {
        // Ignora erros de token em rotas públicas
      }
    }
    return this.videosService.getVideoBySlug(slug, userId);
  }

  @Get(':slug/stream')
  @Public()
  async streamVideo(@Param('slug') slug: string, @Res() res: Response) {
    const url = await this.videosService.getStreamUrl(slug);
    return res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':slug/download')
  @Public()
  async downloadVideo(@Param('slug') slug: string, @Res() res: Response) {
    const url = await this.videosService.getDownloadUrl(slug);
    return res.redirect(HttpStatus.FOUND, url);
  }
}
