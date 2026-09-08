import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProtectionRepricedAtToTrade1788842955946 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "protectionRepricedAt" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "protectionRepricedAt"
    `);
  }
}
