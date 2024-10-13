import { Injectable } from '@nestjs/common';
import {
  DescribeInstancesCommand,
  DescribeInstanceTypesCommand,
  DescribeVolumesCommand,
  EC2Client,
  Instance,
  InstanceTypeInfo,
  Volume,
} from '@aws-sdk/client-ec2';

@Injectable()
export class EC2Service {
  private ec2Client: EC2Client;

  constructor() {
    // EC2 클라이언트 초기화
    this.ec2Client = new EC2Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  // // EC2 인스턴스 정보를 조회하는 메인 메서드
  // async getEC2InstancesInfo(userId: string) {

  //   // const
  //   try {
  //     const instances = await this.getAllInstances();
  //     const instanceTypeInfos = await this.getInstanceTypeInfos(instances);
  //     const volumeInfos = await this.getVolumesInfo(instances);

  //     // 각 인스턴스 정보를 매핑하여 반환
  //     return instances.map((instance) =>
  //       this.mapInstanceInfo(instance, instanceTypeInfos, volumeInfos),
  //     );
  //   } catch (error) {
  //     console.error('EC2 인스턴스 정보 조회 중 오류 발생:', error);
  //     throw error;
  //   }
  // }

  // EC2 인스턴스 정보를 조회하는 메인 메서드
  async getEC2InstancesInfo() {
    try {
      const instances = await this.getAllInstances();
      const instanceTypeInfos = await this.getInstanceTypeInfos(instances);
      const volumeInfos = await this.getVolumesInfo(instances);

      // 각 인스턴스 정보를 매핑하여 반환
      return instances.map((instance) =>
        this.mapInstanceInfo(instance, instanceTypeInfos, volumeInfos),
      );
    } catch (error) {
      console.error('EC2 인스턴스 정보 조회 중 오류 발생:', error);
      throw error;
    }
  }

  // 모든 EC2 인스턴스를 조회하는 private 메서드
  private async getAllInstances(): Promise<Instance[]> {
    const command = new DescribeInstancesCommand({});
    const data = await this.ec2Client.send(command);
    return data.Reservations.flatMap((reservation) => reservation.Instances);
  }

  // 인스턴스 타입 정보를 조회하는 private 메서드
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

    // 인스턴스 타입 정보를 객체로 변환
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

  // 볼륨 정보를 조회하는 private 메서드
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

    // 볼륨 정보를 객체로 변환
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

  // 인스턴스 정보를 매핑하는 private 메서드
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
}
