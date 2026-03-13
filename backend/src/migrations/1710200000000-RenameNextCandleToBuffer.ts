import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameNextCandleToBuffer1710200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename nextCandleEntry column to bufferEntry
    await queryRunner.query(`
      ALTER TABLE "strategy"
      RENAME COLUMN "nextCandleEntry" TO "bufferEntry"
    `);

    // Rename nextCandlePercentage column to bufferPercentage
    await queryRunner.query(`
      ALTER TABLE "strategy"
      RENAME COLUMN "nextCandlePercentage" TO "bufferPercentage"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert bufferPercentage back to nextCandlePercentage
    await queryRunner.query(`
      ALTER TABLE "strategy"
      RENAME COLUMN "bufferPercentage" TO "nextCandlePercentage"
    `);

    // Revert bufferEntry back to nextCandleEntry
    await queryRunner.query(`
      ALTER TABLE "strategy"
      RENAME COLUMN "bufferEntry" TO "nextCandleEntry"
    `);
  }
}
