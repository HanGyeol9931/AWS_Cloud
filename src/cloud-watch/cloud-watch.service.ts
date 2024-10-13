import { Injectable } from '@nestjs/common';
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';

@Injectable()
export class CloudWatchService {
  private cloudwatchClient: CloudWatchClient;
  private ec2Client: EC2Client;

  constructor() {
    this.cloudwatchClient = new CloudWatchClient({
      region: 'ap-northeast-2', // 사용중인 AWS 리전
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, // 환경 변수에서 설정
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.ec2Client = new EC2Client({
      region: 'ap-northeast-2', // AWS 리전 설정
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  // 모든 EC2 인스턴스의 InstanceId, ImageId, InstanceType 조회하는 메서드
  async getAllInstanceDetails() {
    const params = {};
    const command = new DescribeInstancesCommand(params);
    const data = await this.ec2Client.send(command);

    // Reservations 배열에서 인스턴스 ID, Image ID, Instance Type만 추출
    const instanceDetails = data.Reservations?.flatMap((reservation) =>
      reservation.Instances
        ? reservation.Instances.map((instance) => ({
            InstanceId: instance.InstanceId,
            ImageId: instance.ImageId,
            InstanceType: instance.InstanceType,
          }))
        : [],
    );

    return instanceDetails;
  }

  async getAllMetrics(
    instanceId: string,
    imageId: string,
    instanceType: string,
  ) {
    if (!instanceId || instanceId.length === 0) {
      throw new Error('Invalid Instance ID');
    }

    try {
      // CPU, 메모리, 디스크 사용량을 동시에 가져오기 위해 Promise.all 사용
      const [cpuUsage, memoryUsage, diskUsage] = await Promise.all([
        this.getCpuUsage(instanceId),
        this.getMemoryUsage(instanceId, imageId, instanceType),
        this.getDiskUsage(instanceId, imageId, instanceType),
      ]);

      // 필요한 형태로 데이터를 매핑하여 반환
      return {
        instanceId,
        imageId,
        instanceType,
        cpuUsage: cpuUsage[0]?.Values || [], // cpu 메트릭 값
        memoryUsage: memoryUsage[0]?.Values || [], // 메모리 메트릭 값
        diskUsage: diskUsage[0]?.Values || [], // 디스크 메트릭 값
      };
    } catch (error) {
      console.error('Error fetching metrics:', error);
      throw new Error('Unable to fetch metrics');
    }
  }

  // CPU 사용량 가져오기
  async getCpuUsage(instanceId: string) {
    if (!instanceId || instanceId.length === 0) {
      throw new Error('Invalid Instance ID');
    }

    const params = {
      StartTime: new Date(new Date().getTime() - 60 * 60 * 1000), // 1시간 전
      EndTime: new Date(),
      MetricDataQueries: [
        {
          Id: 'cpuUsage',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/EC2',
              MetricName: 'CPUUtilization',
              Dimensions: [
                {
                  Name: 'InstanceId',
                  Value: instanceId, // 인스턴스 ID 값
                },
              ],
            },
            Period: 60, // 1분 간격
            Stat: 'Average',
          },
        },
      ],
    };

    const command = new GetMetricDataCommand(params);
    const data = await this.cloudwatchClient.send(command);
    return data.MetricDataResults;
  }

  // 메모리 사용량 가져오기
  async getMemoryUsage(
    instanceId: string,
    imageId: string,
    instanceType: string,
  ) {
    console.log(instanceId, imageId, instanceType);
    const params = {
      StartTime: new Date(new Date().getTime() - 60 * 60 * 1000), // 1시간 전부터
      EndTime: new Date(),
      MetricDataQueries: [
        {
          Id: 'memoryUsage',
          MetricStat: {
            Metric: {
              Namespace: 'CWAgent',
              MetricName: 'mem_used_percent', // 메모리 사용률 메트릭
              Dimensions: [
                {
                  Name: 'InstanceId',
                  Value: instanceId,
                },
                {
                  Name: 'ImageId',
                  Value: imageId,
                },
                {
                  Name: 'InstanceType',
                  Value: instanceType,
                },
              ],
            },
            Period: 60, // 1분 간격
            Stat: 'Average',
          },
        },
      ],
    };

    const command = new GetMetricDataCommand(params);
    const data = await this.cloudwatchClient.send(command);
    return data.MetricDataResults;
  }
  // 모든 디스크 정보 추출
  extractAllDiskInfo(instanceDetails: any) {
    const blockDeviceMappings = instanceDetails.BlockDeviceMappings;

    // 모든 디바이스 정보 추출
    return blockDeviceMappings.map((mapping) => ({
      device: mapping.DeviceName || '/dev/xvda1',
      fstype: 'xfs', // 예시로 기본값 지정
      mountPath: '/', // 기본값으로 루트 경로
    }));
  }
  // 디스크 사용량 가져오기
  async getDiskUsage(
    instanceId: string,
    imageId: string,
    instanceType: string,
  ) {
    console.log(instanceId, imageId, instanceType);

    // EC2 인스턴스의 디스크 정보를 조회하는 부분
    const instanceDetails = await this.getEC2InstanceDetails(instanceId);
    const deviceInfo = this.extractDiskInfo(instanceDetails);
    const devices = this.extractAllDiskInfo(instanceDetails);

    console.log(deviceInfo);
    console.log(devices);

    const dimensions = [
      { Name: 'InstanceId', Value: instanceId },
      { Name: 'ImageId', Value: imageId },
      { Name: 'InstanceType', Value: instanceType },
      { Name: 'device', Value: 'xvda1' }, // 디스크 장치 이름
      { Name: 'fstype', Value: deviceInfo.fstype }, // 파일 시스템 타입
      { Name: 'path', Value: deviceInfo.mountPath }, // 마운트 경로
    ];

    const params = {
      StartTime: new Date(new Date().getTime() - 60 * 60 * 1000), // 1시간 전부터
      EndTime: new Date(),
      MetricDataQueries: [
        {
          Id: 'diskUsage',
          MetricStat: {
            Metric: {
              Namespace: 'CWAgent',
              MetricName: 'disk_used_percent',
              Dimensions: dimensions,
            },
            Period: 60, // 1분 간격
            Stat: 'Average',
          },
        },
      ],
    };

    const command = new GetMetricDataCommand(params);
    const data = await this.cloudwatchClient.send(command);
    return data.MetricDataResults;
  }

  // EC2 인스턴스의 디스크 정보를 조회하는 메서드
  async getEC2InstanceDetails(instanceId: string) {
    const params = {
      InstanceIds: [instanceId],
    };

    const command = new DescribeInstancesCommand(params);
    const data = await this.ec2Client.send(command);

    return data.Reservations?.[0]?.Instances?.[0];
  }

  // 디스크 정보 추출 메서드
  extractDiskInfo(instanceDetails: any) {
    const blockDeviceMappings = instanceDetails.BlockDeviceMappings;

    // 실제 디바이스 정보 추출 (가장 첫 번째 장치를 가져오는 예시)
    const device = blockDeviceMappings[0]?.DeviceName || '/dev/xvda1'; // 기본 값 설정
    const fstype = 'xfs'; // 파일 시스템 타입 기본 값 (필요시 수동 변경)
    const mountPath = '/'; // 기본 루트 경로

    return { device, fstype, mountPath };
  }
}
