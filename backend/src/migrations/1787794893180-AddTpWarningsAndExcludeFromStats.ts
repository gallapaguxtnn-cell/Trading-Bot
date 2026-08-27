import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTpWarningsAndExcludeFromStats1787794893180 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "tpWarnings" text
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      ADD COLUMN "excludeFromStats" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "excludeFromStats"
    `);

    await queryRunner.query(`
      ALTER TABLE "trade"
      DROP COLUMN "tpWarnings"
    `);
  }
}
