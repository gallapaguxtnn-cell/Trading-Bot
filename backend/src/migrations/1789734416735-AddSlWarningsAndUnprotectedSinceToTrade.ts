import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlWarningsAndUnprotectedSinceToTrade1789734416735 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "slWarnings" text
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "unprotectedSince" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "unprotectedSince"
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "slWarnings"
    `);
  }
}
