import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPassphraseAndRegionToPortfolio1788932000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "portfolio"
      ADD COLUMN "apiPassphrase" TEXT,
      ADD COLUMN "region" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "portfolio"
      DROP COLUMN "apiPassphrase",
      DROP COLUMN "region"
    `);
  }
}
