import { Controller, Get, Query } from '@nestjs/common';
import { CloudWatchService } from './cloud-watch.service';

@Controller('cloudwatch')
export class CloudWatchController {
  constructor(private readonly cloudWatchService: CloudWatchService) {}

  @Get('instances')
  async getAllInstanceDetails() {
    return this.cloudWatchService.getAllInstanceDetails();
  }

  @Get('metrics')
  async getAllMetrics(
    @Query('instanceId') instanceId: string,
    @Query('imageId') imageId: string,
    @Query('instanceType') instanceType: string,
  ) {
    return this.cloudWatchService.getAllMetrics(
      instanceId,
      imageId,
      instanceType,
    );
  }

  @Get('cpu-usage')
  async getCpuUsage(@Query('instanceId') instanceId: string) {
    return this.cloudWatchService.getCpuUsage(instanceId);
  }

  @Get('memory-usage')
  async getMemoryUsage(
    @Query('instanceId') instanceId: string,
    @Query('imageId') imageId: string,
    @Query('instanceType') instanceType: string,
  ) {
    return this.cloudWatchService.getMemoryUsage(
      instanceId,
      imageId,
      instanceType,
    );
  }

  @Get('disk-usage')
  async getDiskUsage(
    @Query('instanceId') instanceId: string,
    @Query('imageId') imageId: string,
    @Query('instanceType') instanceType: string,
  ) {
    return this.cloudWatchService.getDiskUsage(
      instanceId,
      imageId,
      instanceType,
    );
  }
}
