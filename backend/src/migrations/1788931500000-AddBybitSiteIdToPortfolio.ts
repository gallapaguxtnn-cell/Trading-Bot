import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBybitSiteIdToPortfolio1788931500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "portfolio"
      ADD COLUMN "bybitSiteId" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "portfolio"
      DROP COLUMN "bybitSiteId"
    `);
  }
}
