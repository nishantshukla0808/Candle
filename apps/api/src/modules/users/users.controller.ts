import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public, Strict } from '../../common/decorators/route.decorators';
import { AppError } from '../../common/errors/app-error';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

/**
 * UsersController — profile + avatar (blueprint §4/§10/§11).
 *
 * Ownership by construction: mutation routes are /users/me, so there is
 * no user-id parameter to tamper with. GET /users/:id returns the public
 * profile only — never email, never hashes.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my full profile.' })
  getMe(@CurrentUser() user: RequestUser) {
    return this.users.getMe(user.sub);
  }

  @Patch('me')
  @Strict(UpdateProfileDto)
  @ApiOperation({ summary: 'Update my profile.' })
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateMe(user.sub, dto);
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload my avatar (image only, 2 MB default).' })
  @UseInterceptors(
    FileInterceptor('avatar', {
      // Multer-level guard; StorageService re-validates by magic bytes (§10).
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    })
  )
  async uploadAvatar(@CurrentUser() user: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw AppError.validationFailed([{ field: 'avatar', issue: 'An image file is required.' }]);
    }
    return this.users.setAvatar(user.sub, file.buffer);
  }

  @Get('me/avatar')
  @ApiOperation({ summary: 'Download my avatar.' })
  async downloadOwnAvatar(@CurrentUser() user: RequestUser, @Res() res: Response): Promise<void> {
    const path = await this.users.resolveOwnAvatarPath(user.sub);
    res.sendFile(path);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get the public profile of any user (privacy-filtered).' })
  getPublicUser(
    @CurrentUser() viewer: RequestUser | undefined,
    @Param() params: IdParamDto
  ) {
    return this.users.getPublicUser(viewer?.sub ?? null, params.id);
  }

  @Public()
  @Get(':id/avatar')
  @ApiOperation({ summary: 'Download the public avatar of any user.' })
  async downloadPublicAvatar(@Param() params: IdParamDto, @Res() res: Response): Promise<void> {
    const path = await this.users.resolvePublicAvatarPath(params.id);
    // sendFile with an absolute path is safe: the path came from the
    // storage root via safePath(), never from user input (§10).
    res.sendFile(path);
  }
}
