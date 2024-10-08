import { Controller, Get } from '@nestjs/common';
import { EC2Service } from './ec2.service';

@Controller('ec2')
export class EC2Controller {
  constructor(private readonly ec2Service: EC2Service) {}

  // EC2 인스턴스 정보를 조회하는 엔드포인트
  @Get('instances')
  async getEC2Instances() {
    return this.ec2Service.getEC2InstancesInfo();
  }
}
