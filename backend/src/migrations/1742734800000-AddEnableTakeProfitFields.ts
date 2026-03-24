import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnableTakeProfitFields1742734800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add enableTakeProfit1 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      ADD COLUMN "enableTakeProfit1" boolean NOT NULL DEFAULT true
    `);

    // Add enableTakeProfit2 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      ADD COLUMN "enableTakeProfit2" boolean NOT NULL DEFAULT true
    `);

    // Add enableTakeProfit3 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      ADD COLUMN "enableTakeProfit3" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove enableTakeProfit3 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      DROP COLUMN "enableTakeProfit3"
    `);

    // Remove enableTakeProfit2 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      DROP COLUMN "enableTakeProfit2"
    `);

    // Remove enableTakeProfit1 column
    await queryRunner.query(`
      ALTER TABLE "strategy"
      DROP COLUMN "enableTakeProfit1"
    `);
  }
}
