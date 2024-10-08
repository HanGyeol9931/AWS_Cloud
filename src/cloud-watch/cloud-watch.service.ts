import { Injectable } from '@nestjs/common';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import {
  DescribeInstancesCommand,
  DescribeInstanceTypesCommand,
  DescribeVolumesCommand,
  EC2Client,
  Instance,
  InstanceTypeInfo,
  Volume,
} from '@aws-sdk/client-ec2';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';

@Injectable()
export class CloudWatchService {
  private readonly cloudWatchClient: CloudWatchClient;
  private ec2Client: EC2Client;
  private costExplorerClient: CostExplorerClient;

  constructor() {
    this.ec2Client = new EC2Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.costExplorerClient = new CostExplorerClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }); // 서울 리전
  }

  async getEC2InstancesInfo() {
    try {
      const instances = await this.getAllInstances();
      const instanceTypeInfos = await this.getInstanceTypeInfos(instances);
      const volumeInfos = await this.getVolumesInfo(instances);

      return instances.map((instance) =>
        this.mapInstanceInfo(instance, instanceTypeInfos, volumeInfos),
      );
    } catch (error) {
      console.error('Error fetching EC2 instances:', error);
      throw error;
    }
  }

  private async getAllInstances(): Promise<Instance[]> {
    const command = new DescribeInstancesCommand({});
    const data = await this.ec2Client.send(command);
    return data.Reservations.flatMap((reservation) => reservation.Instances);
  }

  private async getInstanceTypeInfos(
    instances: Instance[],
  ): Promise<Record<string, InstanceTypeInfo>> {
    const uniqueInstanceTypes = [
      ...new Set(instances.map((instance) => instance.InstanceType)),
    ];
    const command = new DescribeInstanceTypesCommand({
      InstanceTypes: uniqueInstanceTypes,
    });
    const response = await this.ec2Client.send(command);

    return response.InstanceTypes.reduce(
      (acc, type) => {
        if (type.InstanceType) {
          acc[type.InstanceType] = type;
        }
        return acc;
      },
      {} as Record<string, InstanceTypeInfo>,
    );
  }

  private async getVolumesInfo(
    instances: Instance[],
  ): Promise<Record<string, Volume>> {
    const volumeIds = instances
      .flatMap((instance) =>
        instance.BlockDeviceMappings.filter(
          (device) => device.Ebs && device.Ebs.VolumeId,
        ).map((device) => device.Ebs.VolumeId),
      )
      .filter((id): id is string => id !== undefined);

    const command = new DescribeVolumesCommand({ VolumeIds: volumeIds });
    const response = await this.ec2Client.send(command);

    return response.Volumes.reduce(
      (acc, volume) => {
        if (volume.VolumeId) {
          acc[volume.VolumeId] = volume;
        }
        return acc;
      },
      {} as Record<string, Volume>,
    );
  }

  private mapInstanceInfo(
    instance: Instance,
    instanceTypeInfos: Record<string, InstanceTypeInfo>,
    volumeInfos: Record<string, Volume>,
  ) {
    const typeInfo = instance.InstanceType
      ? instanceTypeInfos[instance.InstanceType]
      : undefined;

    return {
      InstanceId: instance.InstanceId,
      InstanceType: instance.InstanceType,
      State: instance.State?.Name,
      PublicIpAddress: instance.PublicIpAddress,
      PrivateIpAddress: instance.PrivateIpAddress,
      LaunchTime: instance.LaunchTime,
      CPU: {
        vCPUs: typeInfo?.VCpuInfo?.DefaultVCpus || 'N/A',
      },
      Memory: {
        SizeInGiB: typeInfo?.MemoryInfo?.SizeInMiB
          ? (typeInfo.MemoryInfo.SizeInMiB / 1024).toFixed(2)
          : 'N/A',
      },
      Storage: {
        Devices: instance.BlockDeviceMappings.filter(
          (device) => device.Ebs && device.Ebs.VolumeId,
        ).map((device) => {
          const volumeInfo = device.Ebs?.VolumeId
            ? volumeInfos[device.Ebs.VolumeId]
            : undefined;
          return {
            DeviceName: device.DeviceName,
            VolumeId: device.Ebs?.VolumeId,
            SizeInGiB: volumeInfo?.Size || 'N/A',
          };
        }),
      },
      Tags:
        instance.Tags?.reduce(
          (acc, tag) => {
            if (tag.Key) {
              acc[tag.Key] = tag.Value || '';
            }
            return acc;
          },
          {} as Record<string, string>,
        ) || {},
    };
  }

  async getBillingCosts() {
    try {
      const billingData = await this.getCurrentAndLastMonthActualBilledCost();
      return {
        status: 'success',
        data: {
          lastMonth: {
            startDate: billingData.lastMonth.startDate,
            endDate: billingData.lastMonth.endDate,
            amortizedCost: billingData.lastMonth.amortizedCost,
            unblendedCost: billingData.lastMonth.unblendedCost,
            currency: billingData.lastMonth.currency,
          },
        },
      };
    } catch (error) {
      console.error('Error fetching billing costs:', error);
      return {
        status: 'error',
        message: '비용 데이터를 가져오는 중 오류가 발생했습니다.',
        error: error.message,
      };
    }
  }

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
      console.error('Error fetching actual billed cost:', error);
      throw error;
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
