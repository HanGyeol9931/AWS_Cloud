import { Controller, Post } from '@nestjs/common';
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
}
