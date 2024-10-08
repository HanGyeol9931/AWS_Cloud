import { Controller, Post, Body, Param, Delete } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post('invite')
  async inviteAccount(@Body('email') email: string) {
    return this.organizationsService.inviteAccountToOrganization(email);
  }

  @Post('accept/:handshakeId')
  async acceptInvitation(@Param('handshakeId') handshakeId: string) {
    await this.organizationsService.acceptHandshake(handshakeId);
    return { message: '초대가 수락되었습니다.' };
  }

  @Delete('invitation/:handshakeId')
  async cancelInvitation(@Param('handshakeId') handshakeId: string) {
    await this.organizationsService.cancelInvitation(handshakeId);
    return { message: '초대가 취소되었습니다.' };
  }
}
