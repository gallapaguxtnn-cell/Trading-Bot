import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSignalPriceFilledAtStopLossPercentageToTrade1788930015782 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "signalPrice" DECIMAL(18,8),
      ADD COLUMN "filledAt" TIMESTAMPTZ,
      ADD COLUMN "stopLossPercentage" DECIMAL(8,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "signalPrice",
      DROP COLUMN "filledAt",
      DROP COLUMN "stopLossPercentage"
    `);
  }
}
