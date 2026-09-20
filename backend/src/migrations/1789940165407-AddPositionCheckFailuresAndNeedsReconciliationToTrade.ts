import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPositionCheckFailuresAndNeedsReconciliationToTrade1789940165407 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "positionCheckFailures" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "needsReconciliation" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "needsReconciliation"
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "positionCheckFailures"
    `);
  }
}
