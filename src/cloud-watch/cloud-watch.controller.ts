import { Body, Controller, Post } from '@nestjs/common';
import { CloudWatchService } from './cloud-watch.service';

@Controller('cloudwatch')
export class CloudWatchController {
  constructor(private readonly cloudWatchService: CloudWatchService) {}

  @Post('info')
  async getEC2InstancesInfo() {
    console.log('실행완료');
    return this.cloudWatchService.getEC2InstancesInfo();
  }
  @Post('billing')
  async getBillingCosts() {
    console.log('실행완료');
    return this.cloudWatchService.getBillingCosts();
  }
  @Post('invite')
  async inviteUser(@Body('email') email: string) {
    const handshakeId =
      await this.cloudWatchService.inviteAccountToOrganization(email);
    return { message: 'Invitation sent', handshakeId };
  }

  @Post('accept')
  async acceptInvitation(@Body('handshakeId') handshakeId: string) {
    await this.cloudWatchService.acceptHandshake(handshakeId);
    return { message: 'Invitation accepted' };
  }

  @Post('accept')
  async cancelInvitation(@Body('handshakeId') handshakeId: string) {
    await this.cloudWatchService.cancelInvitation(handshakeId);
    return { message: 'Invitation cancel' };
  }

  @Post('organization/info')
  async getOrganizationInfo() {
    return this.cloudWatchService.getOrganizationInfo();
  }

  @Post('organization/accounts')
  async listMemberAccounts() {
    return this.cloudWatchService.listMemberAccounts();
  }

  @Post('organization/invitation')
  async listInvitations() {
    return this.cloudWatchService.listInvitations();
  }
}
