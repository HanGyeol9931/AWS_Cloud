import { Module } from '@nestjs/common';
import { CloudWatchController } from './cloud-watch.controller';
import { CloudWatchService } from './cloud-watch.service';

@Module({
  controllers: [CloudWatchController],
  providers: [CloudWatchService],
})
export class CloudWatchModule {}
