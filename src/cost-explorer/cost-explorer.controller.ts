import { Controller, Get } from '@nestjs/common';
import { CostExplorerService } from './cost-explorer.service';

@Controller('cost-explorer')
export class CostExplorerController {
  constructor(private readonly costExplorerService: CostExplorerService) {}

  // 청구 비용을 조회하는 엔드포인트
  @Get('billing')
  async getBillingCosts() {
    return this.costExplorerService.getBillingCosts();
  }
}
