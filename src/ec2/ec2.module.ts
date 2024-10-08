import { Module } from '@nestjs/common';
import { EC2Controller } from './ec2.controller';
import { EC2Service } from './ec2.service';

@Module({
  controllers: [EC2Controller],
  providers: [EC2Service],
})
export class EC2Module {}
