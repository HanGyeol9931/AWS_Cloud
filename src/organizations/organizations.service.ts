import { Injectable } from '@nestjs/common';
import {
  AcceptHandshakeCommand,
  CancelHandshakeCommand,
  Handshake,
  InviteAccountToOrganizationCommand,
  ListHandshakesForAccountCommand,
  OrganizationsClient,
} from '@aws-sdk/client-organizations';

@Injectable()
export class OrganizationsService {
  private organizationsClient: OrganizationsClient;
  private organizationsUserClient: OrganizationsClient;

  constructor() {
    // Organizations 클라이언트 초기화
    this.organizationsClient = new OrganizationsClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    // 사용자용 Organizations 클라이언트 초기화
    this.organizationsUserClient = new OrganizationsClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_USER_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_USER_SECRET_ACCESS_KEY,
      },
    });
  }

  // 조직에 계정 초대
  async inviteAccountToOrganization(email: string): Promise<string | null> {
    // 먼저 기존 초대 확인
    const existingInvitation = await this.checkExistingInvitation(email);

    console.log('existingInvitation', existingInvitation);
    if (existingInvitation) {
      console.log(`${email}에 대한 기존 초대가 있습니다.`);
      return existingInvitation.Id;
    }

    // 기존 초대가 없으면 새 초대 생성
    const command = new InviteAccountToOrganizationCommand({
      Target: { Type: 'EMAIL', Id: email },
    });
    const response = await this.organizationsClient.send(command);
    return response.Handshake.Id;
  }

  // 초대 수락
  async acceptHandshake(handshakeId: string): Promise<void> {
    const command = new AcceptHandshakeCommand({ HandshakeId: handshakeId });
    await this.organizationsUserClient.send(command);
  }

  // 초대 취소
  async cancelInvitation(handshakeId: string): Promise<void> {
    try {
      const command = new CancelHandshakeCommand({ HandshakeId: handshakeId });
      await this.organizationsClient.send(command);
    } catch (error) {
      console.error('초대 취소 중 오류 발생:', error);
      throw error;
    }
  }

  // 기존 초대 확인
  private async checkExistingInvitation(
    email: string,
  ): Promise<Handshake | null> {
    try {
      const command = new ListHandshakesForAccountCommand({});
      const response = await this.organizationsUserClient.send(command);

      console.log(`${email}에 대한 기존 초대 확인 중`);
      console.log(
        '모든 핸드셰이크:',
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
          `기존 초대 발견: ${JSON.stringify(existingInvitation, null, 2)}`,
        );
      } else {
        console.log(`${email}에 대한 기존 초대를 찾지 못했습니다.`);
      }

      return existingInvitation || null;
    } catch (error) {
      console.error('기존 초대 확인 중 오류 발생:', error);
      throw error;
    }
  }
}
