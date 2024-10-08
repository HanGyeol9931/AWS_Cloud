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
import {
  AcceptHandshakeCommand,
  Account,
  CancelHandshakeCommand,
  DescribeOrganizationCommand,
  Handshake,
  InviteAccountToOrganizationCommand,
  ListAccountsCommand,
  ListHandshakesForAccountCommand,
  Organization,
  OrganizationsClient,
} from '@aws-sdk/client-organizations';

@Injectable()
export class CloudWatchService {
  private readonly cloudWatchClient: CloudWatchClient;
  private ec2Client: EC2Client;
  private costExplorerClient: CostExplorerClient;
  private organizationsClient: OrganizationsClient;
  private organizationsUserClient: OrganizationsClient;

  constructor() {
    this.organizationsClient = new OrganizationsClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.organizationsUserClient = new OrganizationsClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_USER_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_USER_SECRET_ACCESS_KEY,
      },
    });

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

  async inviteAccountToOrganization(email: string): Promise<string | null> {
    // 먼저 기존 초대 확인
    const existingInvitation = await this.checkExistingInvitation(email);

    console.log('existingInvitation', existingInvitation);
    if (existingInvitation) {
      console.log(`Existing invitation found for ${email}`);
      return existingInvitation.Id;
    }

    // 기존 초대가 없으면 새 초대 생성

    const command = new InviteAccountToOrganizationCommand({
      Target: { Type: 'EMAIL', Id: email },
    });
    const response = await this.organizationsClient.send(command);
    return response.Handshake.Id;
  }

  async acceptHandshake(handshakeId: string): Promise<void> {
    const command = new AcceptHandshakeCommand({ HandshakeId: handshakeId });
    await this.organizationsUserClient.send(command);
  }

  async getOrganizationInfo(): Promise<Organization | null> {
    try {
      const command = new DescribeOrganizationCommand({});
      const response = await this.organizationsClient.send(command);
      return response.Organization;
    } catch (error) {
      console.error('Error fetching organization info:', error);
      throw error;
    }
  }

  async listMemberAccounts(): Promise<Account[]> {
    try {
      const command = new ListAccountsCommand({});
      const response = await this.organizationsClient.send(command);
      return response.Accounts || [];
    } catch (error) {
      console.error('Error listing member accounts:', error);
      throw error;
    }
  }

  private async checkExistingInvitation(
    email: string,
  ): Promise<Handshake | null> {
    try {
      const command = new ListHandshakesForAccountCommand({});
      const response = await this.organizationsUserClient.send(command);

      console.log(`Checking existing invitations for ${email}`);
      console.log(
        'All handshakes:',
        JSON.stringify(response.Handshakes, null, 2),
      );

      const existingInvitation = response.Handshakes?.find(
        (handshake) =>
          handshake.Action === 'INVITE' &&
          handshake.State === 'OPEN' &&
          handshake.Parties?.some(
            (party) =>
              party.Type === 'EMAIL' &&
              party.Id.toLowerCase() === email.toLowerCase(),
          ),
      );

      if (existingInvitation) {
        console.log(
          `Found existing invitation: ${JSON.stringify(existingInvitation, null, 2)}`,
        );
      } else {
        console.log(`No existing invitation found for ${email}`);
      }

      return existingInvitation || null;
    } catch (error) {
      console.error('Error in checkExistingInvitation:', error);
      throw error;
    }
  }

  async listInvitations(): Promise<Handshake[]> {
    try {
      const command = new ListHandshakesForAccountCommand({
        Filter: {
          ActionType: 'INVITE',
        },
      });
      const response = await this.organizationsUserClient.send(command);
      return response.Handshakes || [];
    } catch (error) {
      console.error('Error listing invitations:', error);
      throw error;
    }
  }

  async cancelInvitation(handshakeId: string): Promise<void> {
    try {
      const command = new CancelHandshakeCommand({ HandshakeId: handshakeId });
      await this.organizationsClient.send(command);
    } catch (error) {
      console.error('Error canceling invitation:', error);
      throw error;
    }
  }
}
