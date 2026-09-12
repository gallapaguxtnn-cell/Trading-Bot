import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeeToTradeExecution1788929412350 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_execution"
      ADD COLUMN "fee" DECIMAL(18,8)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_execution"
      DROP COLUMN "fee"
    `);
  }
}
