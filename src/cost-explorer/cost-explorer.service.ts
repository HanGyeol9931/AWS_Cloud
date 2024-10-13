import { Injectable } from '@nestjs/common';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
import {
  DescribeAccountCommand,
  OrganizationsClient,
} from '@aws-sdk/client-organizations';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

@Injectable()
export class CostExplorerService {
  private costExplorerClient: CostExplorerClient;

  constructor() {
    // Cost Explorer 클라이언트 초기화
    this.costExplorerClient = new CostExplorerClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async getBillingCosts() {
    try {
      const billingData = await this.getCurrentAndLastMonthActualBilledCost();

      const client = new STSClient({
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_USER_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_USER_SECRET_ACCESS_KEY,
        },
      });

      const command1 = new GetCallerIdentityCommand({});
      const response1 = await client.send(command1);

      const memberAccountsData = await this.getMemberAccountsBilling(
        '2023-10-01',
        '2024-10-30',
      );

      return {
        status: 'success',
        data: {
          test: response1.Account,
          lastMonth: {
            startDate: billingData.lastMonth.startDate,
            endDate: billingData.lastMonth.endDate,
            amortizedCost: billingData.lastMonth.amortizedCost,
            unblendedCost: billingData.lastMonth.unblendedCost,
            currency: billingData.lastMonth.currency,
          },
          memberAccounts: memberAccountsData,
        },
      };
    } catch (error) {
      console.error('결제 비용 조회 중 오류 발생:', error);
      return {
        status: 'error',
        message: '비용 데이터를 가져오는 중 오류가 발생했습니다.',
        error: error.message,
      };
    }
  }

  // 현재 월과 지난 달의 실제 청구 비용을 조회하는 private 메서드
  private async getCurrentAndLastMonthActualBilledCost() {
    const now = new Date();

    const lastMonthStart = new Date(
      Date.UTC(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const lastMonthEnd = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), 1), // 이번 달 1일로 설정하여 정확한 금액 계산
    );

    const lastMonthEndDisplay = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), 0),
    );

    console.log('lastMonthStart', lastMonthStart);
    console.log('lastMonthEnd', lastMonthEnd);

    const lastMonthCost = await this.getActualBilledCost(
      lastMonthStart,
      lastMonthEnd,
      lastMonthEndDisplay,
    );

    return {
      lastMonth: lastMonthCost,
    };
  }

  // 실제 청구 비용을 조회하는 private 메서드
  private async getActualBilledCost(
    startDate: Date,
    endDate: Date,
    endDisplay: Date,
  ) {
    const params: GetCostAndUsageCommandInput = {
      TimePeriod: {
        Start: this.formatDate(startDate),
        End: this.formatDate(endDate),
      },
      Granularity: 'MONTHLY',
      Metrics: [
        'AmortizedCost',
        'UnblendedCost',
        'NetAmortizedCost',
        'NetUnblendedCost',
        'BlendedCost', // BlendedCost 추가
      ],
    };

    try {
      const command = new GetCostAndUsageCommand(params);
      const response = await this.costExplorerClient.send(command);

      let totalAmortizedCost = 0;
      let totalUnblendedCost = 0;
      let totalNetAmortizedCost = 0;
      let totalNetUnblendedCost = 0;

      response.ResultsByTime.forEach((result) => {
        totalAmortizedCost += parseFloat(result.Total.AmortizedCost.Amount);
        totalUnblendedCost += parseFloat(result.Total.UnblendedCost.Amount);
        totalNetAmortizedCost += parseFloat(
          result.Total.NetAmortizedCost.Amount,
        );
        totalNetUnblendedCost += parseFloat(
          result.Total.NetUnblendedCost.Amount,
        );
      });

      return {
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDisplay),
        amortizedCost: totalAmortizedCost.toFixed(2),
        unblendedCost: totalUnblendedCost.toFixed(2),
        netAmortizedCost: totalNetAmortizedCost.toFixed(2),
        netUnblendedCost: totalNetUnblendedCost.toFixed(2),
        currency: response.ResultsByTime[0]?.Total.AmortizedCost.Unit || 'USD',
      };
    } catch (error) {
      console.error('실제 청구 비용 조회 중 오류 발생:', error);
      throw error;
    }
  }

  // 날짜를 형식화하는 private 메서드
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  // 멤버 계정별 비용을 조회하는 새로운 메서드
  async getMemberAccountsBilling(startDate: string, endDate: string) {
    const params: GetCostAndUsageCommandInput = {
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'MONTHLY',
      Metrics: ['BlendedCost', 'UnblendedCost', 'AmortizedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' }],
      // Filter: {
      //   Dimensions: {
      //     Key: 'LINKED_ACCOUNT',
      //     Values: [accountId],
      //   },
      // },
    };

    try {
      const command = new GetCostAndUsageCommand(params);
      const response = await this.costExplorerClient.send(command);

      return response.ResultsByTime?.map((result) => ({
        timePeriod: result.TimePeriod,
        accounts: result.Groups?.map((group) => ({
          accountId: group.Keys?.[0],
          blendedCost: parseFloat(
            group.Metrics?.BlendedCost.Amount || '0',
          ).toFixed(2),
          unblendedCost: parseFloat(
            group.Metrics?.UnblendedCost.Amount || '0',
          ).toFixed(2),
          amortizedCost: parseFloat(
            group.Metrics?.AmortizedCost.Amount || '0',
          ).toFixed(2),
          currency: group.Metrics?.BlendedCost.Unit || 'USD',
        })),
      }));
    } catch (error) {
      console.error('멤버 계정 비용 조회 중 오류 발생:', error);
      throw error;
    }
  }
}
