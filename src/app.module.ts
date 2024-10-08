import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CloudWatchModule } from './cloud-watch/cloud-watch.module';
import { ConfigModule } from '@nestjs/config';
import { EC2Module } from './ec2/ec2.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { CostExplorerModule } from './cost-explorer/cost-explorer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 이렇게 하면 모든 모듈에서 ConfigService를 사용할 수 있습니다.
    }),
    CloudWatchModule,
    EC2Module,
    OrganizationsModule,
    CostExplorerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
